/**
 * ============================================================================
 * MOTOR WEBAR — CAMADAS DE MEMÓRIA
 * ============================================================================
 * - Gera um alvo MindAR para cada personalidade de `dados.js`
 * - Camada 2.5D (recorte da personagem "saltando" do cartaz)
 * - Placa de museu 3D, alinhada à base e à esquerda do cartaz
 * - Modo simulação (sem câmera / sem targets.mind) via ?debug ou fallback
 * ============================================================================
 */
(() => {
  "use strict";

  /* ------------------------------------------------------------------------
   * CONFIGURAÇÃO
   * --------------------------------------------------------------------- */

  /** Cartaz A3 vertical em unidades virtuais (largura = 1). */
  const A3 = { width: 1.0, height: Math.SQRT2 };

  const FONT = {
    display: "'Big Shoulders Display', 'Oswald', Impact, sans-serif",
    text: "'Inter', system-ui, -apple-system, sans-serif",
  };

  const PALETTE = {
    paper: "#efe6dc",
    ink: "#1a0f0d",
    inkSoft: "#3a2823",
    fallbackAccent: "#d9b800",
  };

  /**
   * Placa de museu.
   * `gap` é o espaço entre a borda esquerda do cartaz e a placa;
   * `bottomOffset` sobe a placa em relação à base do cartaz (0 = alinhada).
   */
  const PLACARD = {
    worldWidth: 0.65,
    gap: 0.04,
    bottomOffset: 0.0,
    z: 0.12,
    canvasWidth: 800,
    padding: 44,
    maxNameLines: 3,
    maxBioLines: 8,
  };

  /** Posição da pré-visualização no modo simulação (câmera na origem). */
  const SIMULATION_POSITION = "0 0.05 -1.65";

  const FONT_LOAD_TIMEOUT_MS = 4000;
  const MAX_PIXEL_RATIO = 2;

  /* ------------------------------------------------------------------------
   * REFERÊNCIAS DO DOM
   * --------------------------------------------------------------------- */

  const $ = (id) => document.getElementById(id);

  const sceneEl = $("ar-scene");
  const startScreen = $("start-screen");
  const btnStart = $("btn-start");
  const startMessage = $("start-message");
  const scannerUi = $("scanner-ui");
  const reticle = $("reticle");
  const statusDot = $("status-dot");
  const statusText = $("status-text");
  const debugBar = $("debug-bar");

  const STATUS_IDLE = "Enquadre um cartaz A3…";
  const BTN_START_HTML = btnStart.innerHTML;

  const people = window.PERSONALIDADES_DB || [];

  /* ------------------------------------------------------------------------
   * ESTADO
   * --------------------------------------------------------------------- */

  let scannerVisible = false;
  let simulationContainer = null;
  let simulatedIndex = null;

  const placardCache = new Map(); // id -> { texture, aspect }
  const textureCache = new Map(); // url -> Promise<THREE.Texture>

  /* ------------------------------------------------------------------------
   * UTILITÁRIOS
   * --------------------------------------------------------------------- */

  /** Executa `fn` quando a entidade A-Frame estiver pronta. */
  function whenEntityReady(el, fn) {
    if (el.hasLoaded) fn();
    else el.addEventListener("loaded", fn, { once: true });
  }

  /** Escolhe tinta escura ou papel claro conforme a luminância do fundo. */
  function readableInk(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
    if (!m) return PALETTE.ink;
    const n = parseInt(m[1], 16);
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.55 ? PALETTE.ink : PALETTE.paper;
  }

  /**
   * Quebra o texto em linhas (usa a fonte atual do contexto).
   * Se passar de `maxLines`, a última linha termina com reticências.
   */
  function wrapLines(ctx, text, maxWidth, maxLines) {
    const words = (text || "").trim().split(/\s+/).filter(Boolean);
    if (!words.length) return [];

    const lines = [];
    let current = words[0];
    for (let i = 1; i < words.length; i++) {
      const test = `${current} ${words[i]}`;
      if (ctx.measureText(test).width > maxWidth) {
        lines.push(current);
        current = words[i];
      } else {
        current = test;
      }
    }
    lines.push(current);

    if (maxLines && lines.length > maxLines) {
      const kept = lines.slice(0, maxLines);
      let last = `${kept[maxLines - 1]}…`;
      while (last.length > 1 && ctx.measureText(last).width > maxWidth) {
        last = `${last.slice(0, -2)}…`;
      }
      kept[maxLines - 1] = last;
      return kept;
    }
    return lines;
  }

  function drawRoundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /** Garante que as fontes usadas no canvas estejam carregadas. */
  async function loadFonts() {
    if (!document.fonts || !document.fonts.load) return;
    const sample = "ÁÇÃÕ Aa";
    const loads = [
      document.fonts.load(`900 78px ${FONT.display}`, sample),
      document.fonts.load(`800 28px ${FONT.display}`, sample),
      document.fonts.load(`500 27px ${FONT.text}`, sample),
      document.fonts.load(`600 20px ${FONT.text}`, sample),
    ];
    const timeout = new Promise((resolve) =>
      setTimeout(resolve, FONT_LOAD_TIMEOUT_MS),
    );
    try {
      await Promise.race([Promise.all(loads), timeout]);
    } catch (err) {
      console.warn("Falha ao carregar fontes do canvas:", err);
    }
  }

  function getMaxAnisotropy() {
    const renderer = sceneEl.renderer;
    const max = renderer?.capabilities?.getMaxAnisotropy?.() || 4;
    return Math.min(8, max);
  }

  function loadTexture(url) {
    if (!textureCache.has(url)) {
      textureCache.set(
        url,
        new Promise((resolve, reject) => {
          new THREE.TextureLoader().load(
            url,
            (texture) => {
              texture.colorSpace = THREE.SRGBColorSpace;
              texture.anisotropy = getMaxAnisotropy();
              resolve(texture);
            },
            undefined,
            reject,
          );
        }),
      );
    }
    return textureCache.get(url);
  }

  /** Libera geometrias/materiais de uma entidade (texturas ficam em cache). */
  function disposeEntity(el) {
    el.object3D.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    });
  }

  /* ------------------------------------------------------------------------
   * 1. PLACA DE MUSEU (TEXTURA EM CANVAS)
   *    Papel creme, tarja colorida, tipografia condensada: mesma linguagem
   *    dos cartazes impressos.
   * --------------------------------------------------------------------- */

  function paintPaperGrain(ctx, width, height) {
    const specks = Math.round((width * height) / 240);
    for (let i = 0; i < specks; i++) {
      const alpha = 0.02 + Math.random() * 0.06;
      const size = Math.random() < 0.85 ? 1 : 2;
      ctx.fillStyle = `rgba(26, 15, 13, ${alpha.toFixed(3)})`;
      ctx.fillRect(Math.random() * width, Math.random() * height, size, size);
    }
  }

  function createMuseumPlacardTexture(person) {
    const { canvasWidth: W, padding: P } = PLACARD;
    const innerW = W - P * 2;
    const accent = person.corDestaque || PALETTE.fallbackAccent;
    const onAccent = readableInk(accent);

    const canvas = document.createElement("canvas");
    canvas.width = W;
    const ctx = canvas.getContext("2d");

    const fonts = {
      chip: `800 28px ${FONT.display}`,
      name: `900 78px ${FONT.display}`,
      bio: `500 27px ${FONT.text}`,
      footer: `600 19px ${FONT.text}`,
    };
    const metrics = {
      bar: 20,
      chipH: 46,
      nameLH: 74,
      bioLH: 40,
      rule: 6,
    };

    // 1) Mede o conteúdo para definir a altura exata do canvas.
    ctx.font = fonts.name;
    const nameLines = wrapLines(
      ctx,
      (person.nomeCompleto || "").toUpperCase(),
      innerW,
      PLACARD.maxNameLines,
    );
    ctx.font = fonts.bio;
    const bioLines = wrapLines(
      ctx,
      person.resumoFeitos,
      innerW,
      PLACARD.maxBioLines,
    );

    const chipTop = metrics.bar + 36;
    const nameTop = chipTop + metrics.chipH + 28;
    const ruleTop = nameTop + nameLines.length * metrics.nameLH + 12;
    const bioTop = ruleTop + metrics.rule + 30;
    const footerTop = bioTop + bioLines.length * metrics.bioLH + 28;
    const H = Math.ceil(footerTop + 19 + 34);

    canvas.height = H; // redimensionar reseta o contexto
    ctx.textBaseline = "top";

    // 2) Papel + granulado + moldura de tinta.
    ctx.fillStyle = PALETTE.paper;
    ctx.fillRect(0, 0, W, H);
    paintPaperGrain(ctx, W, H);

    ctx.lineWidth = 5;
    ctx.strokeStyle = PALETTE.ink;
    ctx.strokeRect(2.5, 2.5, W - 5, H - 5);

    // 3) Tarja superior colorida.
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, W, metrics.bar);

    // 4) Etiqueta do ano.
    ctx.font = fonts.chip;
    const yearText = (person.anoNascimento || "").toUpperCase();
    const chipW = ctx.measureText(yearText).width + 40;
    ctx.fillStyle = accent;
    ctx.fillRect(P, chipTop, chipW, metrics.chipH);
    ctx.fillStyle = onAccent;
    ctx.fillText(yearText, P + 20, chipTop + 8);

    // 5) Nome em caixa alta condensada.
    ctx.font = fonts.name;
    ctx.fillStyle = PALETTE.ink;
    nameLines.forEach((line, i) => {
      ctx.fillText(line, P, nameTop + i * metrics.nameLH);
    });

    // 6) Régua grossa.
    ctx.fillStyle = PALETTE.ink;
    ctx.fillRect(P, ruleTop, innerW, metrics.rule);

    // 7) Texto biográfico.
    ctx.font = fonts.bio;
    ctx.fillStyle = PALETTE.inkSoft;
    bioLines.forEach((line, i) => {
      ctx.fillText(line, P, bioTop + i * metrics.bioLH);
    });

    // 8) Rodapé discreto, como o crédito dos cartazes.
    ctx.font = fonts.footer;
    ctx.fillStyle = "rgba(26, 15, 13, 0.55)";
    ctx.fillText("CAMADAS DE MEMÓRIA · EXPOSIÇÃO INTERATIVA", P, footerTop);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = getMaxAnisotropy();
    return { texture, aspect: W / H };
  }

  function getPlacard(person) {
    if (!placardCache.has(person.id)) {
      placardCache.set(person.id, createMuseumPlacardTexture(person));
    }
    return placardCache.get(person.id);
  }

  function buildPlacardEntity(person) {
    const el = document.createElement("a-entity");

    whenEntityReady(el, () => {
      const { texture, aspect } = getPlacard(person);
      const width = PLACARD.worldWidth;
      const height = width / aspect;

      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(width, height),
        new THREE.MeshBasicMaterial({
          map: texture,
          transparent: true,
          depthWrite: false,
        }),
      );
      el.setObject3D("mesh", mesh);

      // Alinhada à base do cartaz e encostada na lateral esquerda.
      const x = -(A3.width / 2 + PLACARD.gap + width / 2);
      const y = -A3.height / 2 + height / 2 + PLACARD.bottomOffset;
      el.object3D.position.set(x, y, PLACARD.z);
    });

    return el;
  }

  /* ------------------------------------------------------------------------
   * 2. CAMADA DE DESTAQUE 2.5D (ELEMENTO SALTANTE)
   * --------------------------------------------------------------------- */

  function createFallbackHalo(accent, cfg) {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 640;
    const ctx = canvas.getContext("2d");

    drawRoundedRect(ctx, 20, 20, 472, 600, 44);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 6;
    ctx.setLineDash([45, 25]);
    ctx.stroke();

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;

    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.7, 0.88),
      new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
      }),
    );
    mesh.position.set(cfg.posX, cfg.posY, cfg.profundidadeZ * 0.75);
    return mesh;
  }

  function createCutoutGroup(texture, cfg) {
    const full = cfg.usarPranchetaA3Completa;
    const planeW = (full ? A3.width : 0.75) * cfg.escalaExtra;
    const planeH = (full ? A3.height : 0.95) * cfg.escalaExtra;
    const offsetY = full ? 0 : cfg.posY;
    const geometry = new THREE.PlaneGeometry(planeW, planeH);

    // Sombra projetada suave, atrás do recorte.
    const shadow = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        map: texture,
        color: 0x000000,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
      }),
    );
    shadow.position.set(
      cfg.posX + 0.015,
      offsetY - 0.015,
      cfg.profundidadeZ * 0.4,
    );

    const cutout = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        alphaTest: 0.05,
      }),
    );
    cutout.position.set(cfg.posX, offsetY, cfg.profundidadeZ);

    const group = new THREE.Group();
    group.add(shadow, cutout);
    return group;
  }

  function buildCharacterPopOutLayer(person) {
    const container = document.createElement("a-entity");
    const cfg = person.destaquePopOut;
    if (!cfg || !cfg.ativo) return container;

    // Flutuação suave no eixo Z.
    container.setAttribute(
      "animation__float",
      "property: position; dir: alternate; dur: 2800; easing: easeInOutSine; loop: true; from: 0 0 0; to: 0 0 0.025",
    );

    const holder = document.createElement("a-entity");
    container.appendChild(holder);

    whenEntityReady(holder, async () => {
      try {
        const texture = await loadTexture(cfg.arquivoPNG);
        holder.setObject3D("mesh", createCutoutGroup(texture, cfg));
      } catch {
        holder.setObject3D(
          "mesh",
          createFallbackHalo(person.corDestaque || PALETTE.fallbackAccent, cfg),
        );
      }
    });

    return container;
  }

  function createPerson3DContent(person) {
    const wrapper = document.createElement("a-entity");
    wrapper.appendChild(buildCharacterPopOutLayer(person));
    wrapper.appendChild(buildPlacardEntity(person));
    return wrapper;
  }

  /* ------------------------------------------------------------------------
   * 3. ALVOS DE REALIDADE AUMENTADA
   * --------------------------------------------------------------------- */

  function setStatus(text, locked) {
    statusText.textContent = text;
    statusDot.classList.toggle("active", locked);
    reticle.classList.toggle("locked", locked);
  }

  function handleTargetFound(person) {
    clearSimulation();
    setStatus(person.nomeCompleto, true);
  }

  function handleTargetLost() {
    setStatus(STATUS_IDLE, false);
  }

  async function initARTargets() {
    await loadFonts();

    const fragment = document.createDocumentFragment();
    people.forEach((person) => {
      const targetEl = document.createElement("a-entity");
      targetEl.setAttribute(
        "mindar-image-target",
        `targetIndex: ${person.targetIndex}`,
      );
      targetEl.appendChild(createPerson3DContent(person));
      targetEl.addEventListener("targetFound", () => handleTargetFound(person));
      targetEl.addEventListener("targetLost", handleTargetLost);
      fragment.appendChild(targetEl);
    });
    sceneEl.appendChild(fragment);
  }

  /* ------------------------------------------------------------------------
   * 4. MODO SIMULAÇÃO (SEM CARTAZ FÍSICO)
   * --------------------------------------------------------------------- */

  function clearSimulation() {
    if (!simulationContainer) return;
    disposeEntity(simulationContainer);
    simulationContainer.remove();
    simulationContainer = null;
    simulatedIndex = null;
  }

  function simulateTarget(index) {
    const person = people.find((p) => p.targetIndex === index);
    if (!person) return;

    // Clicar de novo no mesmo número fecha a simulação.
    if (simulatedIndex === index) {
      clearSimulation();
      handleTargetLost();
      return;
    }

    clearSimulation();
    simulatedIndex = index;
    simulationContainer = document.createElement("a-entity");
    simulationContainer.setAttribute("position", SIMULATION_POSITION);
    simulationContainer.appendChild(createPerson3DContent(person));
    sceneEl.appendChild(simulationContainer);

    setStatus(person.nomeCompleto, true);
  }

  function buildDebugBar() {
    if (debugBar.dataset.ready) return;
    debugBar.dataset.ready = "true";

    people.forEach((person) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn-sim";
      btn.textContent = String(person.targetIndex + 1);
      btn.setAttribute("aria-label", `Simular ${person.nomeCompleto}`);
      btn.addEventListener("click", () => simulateTarget(person.targetIndex));
      debugBar.appendChild(btn);
    });
  }

  function showDebugBar() {
    buildDebugBar();
    debugBar.hidden = false;
  }

  window.simulateTarget = simulateTarget; // útil no console do navegador

  /* ------------------------------------------------------------------------
   * 5. CÂMERA E FLUXO DE INICIALIZAÇÃO
   * --------------------------------------------------------------------- */

  /** Mostra a câmera por conta própria caso o MindAR não consiga iniciar. */
  async function ensureCameraFeedVisible() {
    const existing = document.querySelector("body > video");
    if (existing && existing.srcObject) return true;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      let video = $("fallback-camera-video");
      if (!video) {
        video = document.createElement("video");
        video.id = "fallback-camera-video";
        video.setAttribute("playsinline", "");
        video.setAttribute("autoplay", "");
        video.muted = true;
        document.body.prepend(video);
      }
      video.srcObject = stream;
      await video.play();
      return true;
    } catch (err) {
      console.warn("Câmera indisponível:", err);
      return false;
    }
  }

  function showScanner() {
    if (scannerVisible) return;
    scannerVisible = true;
    startScreen.classList.add("hidden");
    scannerUi.classList.add("visible");
  }

  function showStartError(message) {
    startMessage.textContent = message;
    startMessage.hidden = false;
    btnStart.disabled = false;
    btnStart.innerHTML = BTN_START_HTML;
  }

  async function enterSimulationMode() {
    if (scannerVisible) return;
    const hasCamera = await ensureCameraFeedVisible();
    if (!hasCamera) {
      showStartError(
        "Não foi possível acessar a câmera. Verifique a permissão do navegador e tente novamente.",
      );
      return;
    }
    showScanner();
    setStatus("Câmera ativa (modo simulação)", false);
    showDebugBar();
  }

  function whenSceneLoaded() {
    if (sceneEl.hasLoaded) return Promise.resolve();
    return new Promise((resolve) =>
      sceneEl.addEventListener("loaded", resolve, { once: true }),
    );
  }

  btnStart.addEventListener("click", async () => {
    btnStart.disabled = true;
    btnStart.innerHTML = "<span>Abrindo câmera…</span>";
    startMessage.hidden = true;

    await whenSceneLoaded();

    try {
      const system = sceneEl.systems["mindar-image-system"];
      if (!system) throw new Error("Sistema MindAR indisponível");
      await system.start();
    } catch (err) {
      console.error("Falha ao iniciar o MindAR:", err);
      await enterSimulationMode();
    }
  });

  sceneEl.addEventListener("arReady", showScanner);
  sceneEl.addEventListener("arError", enterSimulationMode);

  sceneEl.addEventListener("renderstart", () => {
    const { renderer } = sceneEl;
    if (!renderer) return;
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO),
    );
  });

  /* ------------------------------------------------------------------------
   * INÍCIO
   * --------------------------------------------------------------------- */

  if (new URLSearchParams(window.location.search).has("debug")) {
    showDebugBar();
  }

  initARTargets();
})();
