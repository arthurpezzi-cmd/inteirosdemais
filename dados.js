/**
 * ============================================================================
 * BANCO DE DADOS DOS CARTAZES (6 ALVOS — FORMATO A3 VERTICAL)
 * ============================================================================
 * Para adicionar ou editar uma personalidade, basta alterar a lista no final
 * deste arquivo. Os campos de `destaquePopOut` são opcionais: o que não for
 * informado usa os valores de POP_OUT_PADRAO.
 *
 * DICA PARA O ELEMENTO SALTANTE (EFEITO 2.5D):
 * 1. No Illustrator/Photoshop, deixe visível só a camada da personalidade
 *    (fundo transparente).
 * 2. Exporte em PNG usando "Usar Pranchetas" na mesma proporção A3 do cartaz.
 * 3. Com `usarPranchetaA3Completa: true`, o recorte encaixa exatamente sobre
 *    o cartaz impresso, sem precisar calcular coordenadas.
 *    Se o PNG ainda não existir, o sistema desenha uma moldura de luz.
 *
 * CAMPOS:
 *  - targetIndex   : posição do cartaz dentro do arquivo targets.mind
 *  - corDestaque   : cor da faixa e da etiqueta de ano na placa de museu
 *  - profundidadeZ : quanto a personagem "salta" do papel (metros virtuais)
 *  - escalaExtra   : leve aumento de escala para destacar do fundo impresso
 *  - posX / posY   : ajuste fino (posY só vale sem `usarPranchetaA3Completa`)
 * ============================================================================
 */

(function () {
  "use strict";

  const POP_OUT_PADRAO = {
    ativo: true,
    usarPranchetaA3Completa: true,
    profundidadeZ: 0.08,
    escalaExtra: 1.04,
    posX: 0.0,
    posY: 0.08,
  };

  const nomeArquivo = (indice) =>
    `cartaz-${String(indice + 1).padStart(2, "0")}`;

  function criarPersonalidade(targetIndex, dados) {
    const id = nomeArquivo(targetIndex);
    return {
      targetIndex,
      id,
      ...dados,
      destaquePopOut: {
        ...POP_OUT_PADRAO,
        arquivoPNG: `./assets/recortes/${id}.png`,
        ...(dados.destaquePopOut || {}),
      },
    };
  }

  window.PERSONALIDADES_DB = [
    criarPersonalidade(0, {
      nomeCompleto: "Marsha P. Johnson",
      anoNascimento: "Nasc. 1945",
      resumoFeitos:
        "Breve texto de impacto sobre o que essa pessoa fez, sua atuação histórica e sua importância para a conquista de direitos.",
      corDestaque: "#d9b800", // amarelo do cartaz 01
    }),

    criarPersonalidade(1, {
      nomeCompleto: "Personalidade 02 (Nome Completo)",
      anoNascimento: "Nasc. 1944",
      resumoFeitos:
        "Breve texto sobre a trajetória, pioneirismo cultural e contribuição social desta personalidade ao longo das décadas.",
      corDestaque: "#b8c71a", // verde-limão do cartaz "Abuso de poder"
    }),

    criarPersonalidade(2, {
      nomeCompleto: "Personalidade 03 (Nome Completo)",
      anoNascimento: "Nasc. 1962",
      resumoFeitos:
        "Resumo conciso destacando suas principais obras, mobilizações e o legado construído na defesa da cidadania.",
      corDestaque: "#c4511d", // ferrugem do terceiro cartaz
    }),

    criarPersonalidade(3, {
      nomeCompleto: "Personalidade 04 (Nome Completo)",
      anoNascimento: "Nasc. 1971",
      resumoFeitos:
        "Descrição direta sobre como sua presença e voz abriram novos espaços de visibilidade na cultura e na política.",
      corDestaque: "#ee8a14", // laranja do cartaz "Milionários"
    }),

    criarPersonalidade(4, {
      nomeCompleto: "Personalidade 05 (Nome Completo)",
      anoNascimento: "Nasc. 1980",
      resumoFeitos:
        "Síntese das conquistas históricas e do impacto coletivo gerado pelas iniciativas lideradas por esta personalidade.",
      corDestaque: "#1f7f73", // verde-azulado do cartaz "Abuso de poder"
    }),

    criarPersonalidade(5, {
      nomeCompleto: "Personalidade 06 (Nome Completo)",
      anoNascimento: "Nasc. 1988",
      resumoFeitos:
        "Pequeno texto biográfico ressaltando sua atuação contemporânea e transformação do cenário sociocultural.",
      corDestaque: "#d10f1f", // vermelho do cartaz 01
    }),
  ];
})();
