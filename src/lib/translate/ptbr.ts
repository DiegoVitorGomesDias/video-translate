// Aproxima uma tradução em português europeu do português do Brasil.
// O modelo en→pt do Argos (LibreTranslate) foi treinado com muito texto de Portugal e
// solta "estou a tentar", "que raio", "tu tens", "ecrã"... Regras simples e seguras:
// gerúndio no lugar de "estar a + infinitivo", "tu" → "você", ênclise → próclise no
// pronome átono, e um léxico de palavras que no Brasil são outras.

/** Léxico pt-PT → pt-BR (palavra inteira, sem ambiguidade relevante no contexto de legendas). */
const LEXICON: [string, string][] = [
  ['que raio', 'que diabos'],
  // Gênero muda: artigos e contrações vêm antes da palavra solta.
  ['o ecrã', 'a tela'],
  ['do ecrã', 'da tela'],
  ['no ecrã', 'na tela'],
  ['ao ecrã', 'à tela'],
  ['os ecrãs', 'as telas'],
  ['dos ecrãs', 'das telas'],
  ['nos ecrãs', 'nas telas'],
  ['ecrã', 'tela'],
  ['ecrãs', 'telas'],
  ['a camisola', 'o suéter'],
  ['da camisola', 'do suéter'],
  ['na camisola', 'no suéter'],
  ['a sanita', 'o vaso sanitário'],
  ['da sanita', 'do vaso sanitário'],
  ['na sanita', 'no vaso sanitário'],
  ['autocarro', 'ônibus'],
  ['autocarros', 'ônibus'],
  ['comboio', 'trem'],
  ['comboios', 'trens'],
  ['telemóvel', 'celular'],
  ['telemóveis', 'celulares'],
  ['casa de banho', 'banheiro'],
  ['pequeno-almoço', 'café da manhã'],
  ['pequeno almoço', 'café da manhã'],
  ['frigorífico', 'geladeira'],
  ['chávena', 'xícara'],
  ['sumo de', 'suco de'],
  ['rapariga', 'garota'],
  ['raparigas', 'garotas'],
  ['miúdo', 'garoto'],
  ['miúda', 'garota'],
  ['miúdos', 'garotos'],
  ['miúdas', 'garotas'],
  ['fixe', 'legal'],
  ['equipa', 'equipe'],
  ['equipas', 'equipes'],
  ['facto', 'fato'],
  ['factos', 'fatos'],
  ['contacto', 'contato'],
  ['contactos', 'contatos'],
  ['contactar', 'contatar'],
  ['registo', 'registro'],
  ['registos', 'registros'],
  ['guarda-redes', 'goleiro'],
  ['relvado', 'gramado'],
  ['passadeira', 'faixa de pedestres'],
  ['portagem', 'pedágio'],
  ['boleia', 'carona'],
  ['bué', 'muito'],
  ['bocadinho', 'pouquinho'],
  ['aluguer', 'aluguel'],
  ['utente', 'paciente'],
  ['utentes', 'pacientes'],
  ['utilizador', 'usuário'],
  ['utilizadores', 'usuários'],
  ['ficheiro', 'arquivo'],
  ['ficheiros', 'arquivos'],
  ['hospedeira de bordo', 'comissária de bordo'],
  ['análises ao sangue', 'exames de sangue'],
  ['análise ao sangue', 'exame de sangue'],
  ['constipação', 'resfriado'],
  ['constipado', 'resfriado'],
  ['constipada', 'resfriada'],
  ['sanita', 'vaso sanitário'],
  ['camisola', 'suéter'],
  ['camisolas', 'suéteres'],
  ['sapatilhas', 'tênis'],
  ['percebeste', 'entendeu'],
  ['percebes', 'entende'],
  ['percebo', 'entendo'],
  ['percebi', 'entendi'],
  ['percebem', 'entendem'],
  ['perceber', 'entender'],
  ['gajo', 'cara'],
  ['gajos', 'caras'],
  ['chatice', 'chateação'],
  ['a sério', 'sério'],
  ['de certeza', 'com certeza'],
  ['desporto', 'esporte'],
  ['desportos', 'esportes'],
  ['desportivo', 'esportivo'],
  ['castanho', 'marrom'],
  ['castanhos', 'marrons'],
  ['bebé', 'bebê'],
  ['bebés', 'bebês'],
  ['gémeo', 'gêmeo'],
  ['gémea', 'gêmea'],
  ['gémeos', 'gêmeos'],
  ['gémeas', 'gêmeas'],
  ['fenómeno', 'fenômeno'],
  ['fenómenos', 'fenômenos'],
  ['génio', 'gênio'],
  ['génios', 'gênios'],
  ['cómodo', 'cômodo'],
  ['académico', 'acadêmico'],
  ['académica', 'acadêmica'],
  ['prémio', 'prêmio'],
  ['prémios', 'prêmios'],
  ['ténis', 'tênis'],
  ['oxigénio', 'oxigênio'],
  ['anónimo', 'anônimo'],
  ['anónima', 'anônima'],
  ['tónico', 'tônico'],
  ['polémica', 'polêmica'],
  ['polémico', 'polêmico'],
  ['ingénuo', 'ingênuo'],
  ['ingénua', 'ingênua'],
  ['quilómetro', 'quilômetro'],
  ['quilómetros', 'quilômetros'],
  ['António', 'Antônio'],
  ['pénis', 'pênis'],
  ['fémur', 'fêmur'],
  ['abdómen', 'abdômen'],
  ['esófago', 'esôfago'],
  ['cancro', 'câncer'],
  ['cancros', 'cânceres'],
  ['bloco operatório', 'centro cirúrgico'],
  ['as urgências', 'o pronto-socorro'],
  ['nas urgências', 'no pronto-socorro'],
  ['serviço de urgência', 'pronto-socorro'],
  ['desculpa lá', 'desculpa'],
  ['porreiro', 'legal'],
  ['porreira', 'legal'],
  ['biberão', 'mamadeira'],
  ['canalizador', 'encanador'],
  ['canalização', 'encanamento'],
  ['empregado de mesa', 'garçom'],
  ['empregada de mesa', 'garçonete'],
  ['centro comercial', 'shopping'],
  ['travão', 'freio'],
  ['travões', 'freios'],
  ['camião', 'caminhão'],
  ['camiões', 'caminhões'],
  ['carrinha', 'van'],
  ['mota', 'moto'],
  ['estação de serviço', 'posto de gasolina'],
  ['bomba de gasolina', 'posto de gasolina'],
  ['carta de condução', 'carteira de motorista'],
  ['esquadra', 'delegacia'],
];

// Palavras ambíguas (tipo, rato, penso, gelado, giro, peão...) ficam de fora de propósito.
const RULES = LEXICON.map(([a, b]) => ({
  re: new RegExp(`(?<![\\p{L}\\p{N}-])${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}-])`, 'giu'),
  to: b,
}));

/** Formas do "tu" → "você" (as mais frequentes em diálogo). */
const TU_VERBS: Record<string, string> = {
  és: 'é',
  estás: 'está',
  tens: 'tem',
  fazes: 'faz',
  vais: 'vai',
  podes: 'pode',
  sabes: 'sabe',
  queres: 'quer',
  dizes: 'diz',
  vês: 'vê',
  dás: 'dá',
  vens: 'vem',
  ouves: 'ouve',
  achas: 'acha',
  pensas: 'pensa',
  precisas: 'precisa',
  deves: 'deve',
  ficas: 'fica',
  consegues: 'consegue',
  lembras: 'lembra',
  gostas: 'gosta',
  sentes: 'sente',
  conheces: 'conhece',
  trabalhas: 'trabalha',
  falas: 'fala',
  entendes: 'entende',
  percebes: 'entende',
  foste: 'foi',
  fizeste: 'fez',
  tiveste: 'teve',
  disseste: 'disse',
  viste: 'viu',
  estiveste: 'esteve',
  pudeste: 'pôde',
  quiseste: 'quis',
  soubeste: 'soube',
  vieste: 'veio',
  deste: 'deu',
  puseste: 'pôs',
  eras: 'era',
  estavas: 'estava',
  tinhas: 'tinha',
  fazias: 'fazia',
  ias: 'ia',
  podias: 'podia',
  sabias: 'sabia',
  querias: 'queria',
  devias: 'devia',
  achavas: 'achava',
  serás: 'será',
  estarás: 'estará',
  terás: 'terá',
  serias: 'seria',
  terias: 'teria',
  poderias: 'poderia',
  deverias: 'deveria',
  farias: 'faria',
  gostarias: 'gostaria',
  mataste: 'matou',
  morreste: 'morreu',
  chegaste: 'chegou',
  ficaste: 'ficou',
  falaste: 'falou',
  ouviste: 'ouviu',
  pensaste: 'pensou',
  achaste: 'achou',
  sentiste: 'sentiu',
  perdeste: 'perdeu',
  ganhaste: 'ganhou',
  mentiste: 'mentiu',
  esqueceste: 'esqueceu',
};

const TU_WORDS: Record<string, string> = {
  tu: 'você',
  ti: 'você',
  contigo: 'com você',
  teu: 'seu',
  tua: 'sua',
  teus: 'seus',
  tuas: 'suas',
  vós: 'vocês',
  convosco: 'com vocês',
  vosso: 'seu',
  vossa: 'sua',
  vossos: 'seus',
  vossas: 'suas',
};

const WORD_RE = /(?<![\p{L}\p{N}-])(\p{L}+)(?![\p{L}\p{N}-])/gu;

function keepCase(from: string, to: string): string {
  if (from === from.toUpperCase() && from.length > 1) return to.toUpperCase();
  if (from[0] === from[0]!.toUpperCase()) return to[0]!.toUpperCase() + to.slice(1);
  return to;
}

/** Infinitivo → gerúndio (tentar → tentando, pôr → pondo). */
function gerund(inf: string): string | null {
  const w = inf.toLowerCase();
  if (w === 'pôr' || w.endsWith('pôr')) return w.slice(0, -3) + 'pondo';
  if (w === 'ir') return 'indo';
  if (w === 'vir') return 'vindo';
  if (/[aei]r$/.test(w) && w.length >= 3) return w.slice(0, -1) + 'ndo';
  return null;
}

const ESTAR_A = /\b(est(?:ou|ás|á|amos|ão|ava|avas|ávamos|avam|ive|iveste|eve|ivemos|iveram|arei|ará|aremos|arão|aria|ariam|eja|ejam|ar|ando)|and(?:o|as|a|amos|am|ava|avam|ou|ar)|continu(?:o|as|a|amos|am|ava|avam|ou|ar)|fic(?:o|as|a|amos|am|ava|avam|ou|aram|ar))\s+a\s+(\p{L}+?r)(?![\p{L}])/giu;

/** "estou a tentar" → "estou tentando". */
function gerundize(text: string): string {
  return text.replace(ESTAR_A, (m, aux: string, inf: string) => {
    const g = gerund(inf);
    return g ? `${aux} ${keepCase(inf, g)}` : m;
  });
}

const CLITICS = ['me', 'te', 'se', 'lhe', 'lhes', 'nos', 'vos', 'o', 'a', 'os', 'as', 'lo', 'la', 'los', 'las', 'no', 'na', 'nos', 'nas'];
const ENCLISIS = new RegExp(`(?<![\\p{L}\\p{N}-])(\\p{L}+)-(${CLITICS.join('|')})(?![\\p{L}\\p{N}-])`, 'gu');

/** "Disse-me que sim" → "Me disse que sim"; "dá-lo" → "dá ele"? não: formas em -lo/-no ficam. */
function proclisis(text: string): string {
  return text.replace(ENCLISIS, (m, verb: string, cl: string) => {
    if (/^(l[oa]s?|n[oa]s?)$/.test(cl) && cl !== 'nos') return m;
    if (/^(me|te|se|lhe|lhes|nos|vos)$/.test(cl)) return `${keepCase(verb, cl)} ${verb.toLowerCase() === verb ? verb : verb[0]!.toLowerCase() + verb.slice(1)}`;
    // o/a/os/as: "vi-o" → "o vi"
    return `${keepCase(verb, cl)} ${verb[0]!.toLowerCase() + verb.slice(1)}`;
  });
}

function tuToVoce(text: string): string {
  return text.replace(WORD_RE, (w) => {
    const low = w.toLowerCase();
    const to = TU_WORDS[low] ?? TU_VERBS[low];
    return to ? keepCase(w, to) : w;
  });
}

/** Aplica todas as regras. Idempotente para texto já em pt-BR. */
export function toBrazilian(text: string): string {
  let t = gerundize(text);
  t = proclisis(t);
  t = tuToVoce(t);
  for (const r of RULES) t = t.replace(r.re, (m) => keepCase(m, r.to));
  return t;
}
