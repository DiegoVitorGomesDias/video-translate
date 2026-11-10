// Autoteste do contexto na tradução com o modelo local real (opus-mt-en-ROMANCE, CPU).
// Verifica se os marcadores usados por protectTerms() (701, 702…) sobrevivem à tradução e
// compara com a tradução sem proteção. Baixa o modelo (~113 MB) na primeira vez.
//
//   node --experimental-strip-types scripts/selftest-context.mjs            # frases padrão (Dr. House)
//   node --experimental-strip-types scripts/selftest-context.mjs "House is late." "Tell Wilson."

import os from 'node:os';
import path from 'node:path';
import { AutoModelForSeq2SeqLM, AutoTokenizer, Tensor, env } from '@huggingface/transformers';
import { extractTermsFromTitle, mergeTerms, protectTerms } from '../src/lib/context.ts';

const MODEL = 'Xenova/opus-mt-en-ROMANCE';
env.cacheDir = path.join(os.homedir(), '.cache', 'video-translate-hf');
env.allowLocalModels = false;

const title = process.env.VT_TITLE ?? 'Prime Video: Dr. House';
const terms = mergeTerms(['Cuddy', 'Wilson'], extractTermsFromTitle(title));
const sentences = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      'House is late again.',
      'Dr. House, we need you in the clinic.',
      'Tell Wilson that House was right.',
      'Get out of my house, Cuddy.',
      "That's House's idea, not mine.",
      'Everybody lies, House said.',
      'The house on the corner is empty.',
      'Is House going to be fine?',
    ];

console.log(`modelo: ${MODEL} (wasm/cpu, q8)\ntítulo: "${title}" → termos: ${terms.join(', ')}\n`);
const t0 = performance.now();
const tok = await AutoTokenizer.from_pretrained(MODEL);
const model = await AutoModelForSeq2SeqLM.from_pretrained(MODEL, { dtype: 'q8' });
const vocab = tok.get_vocab();
const langId = vocab.get ? vocab.get('>>pt_br<<') : vocab['>>pt_br<<'];
if (langId === undefined) throw new Error('token >>pt_br<< não encontrado');
console.log(`carregado em ${((performance.now() - t0) / 1000).toFixed(1)} s\n`);

async function translate(text) {
  const enc = tok(text, { add_special_tokens: true });
  const body = Array.from(enc.input_ids.data);
  const ids = BigInt64Array.from([BigInt(langId), ...body]);
  const input_ids = new Tensor('int64', ids, [1, ids.length]);
  const attention_mask = new Tensor('int64', new BigInt64Array(ids.length).fill(1n), [1, ids.length]);
  const out = await model.generate({ input_ids, attention_mask, max_new_tokens: 128 });
  const [decoded] = tok.batch_decode(out, { skip_special_tokens: true });
  return decoded
    .replace(/>>\s*[\w-]+\s*<+/g, ' ')
    .replace(/(^|\s)(<\s*){2,}/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

let ok = 0;
let lost = 0;
for (const en of sentences) {
  const plain = await translate(en);
  const plan = protectTerms(en, terms);
  if (plan.hits.length === 0) {
    console.log(`• ${en}\n    sem termos → ${plain}`);
    continue;
  }
  const protectedOut = await translate(plan.text);
  const restored = plan.restore(protectedOut);
  if (restored === null) lost++;
  else ok++;
  console.log(`• ${en}\n    sem contexto → ${plain}\n    protegido    → ${plan.text} → ${protectedOut}\n    resultado    → ${restored ?? '(marcador perdido; usa a tradução sem contexto)'}`);
}
console.log(`\nmarcadores preservados: ${ok}/${ok + lost}`);
process.exit(lost > 0 && ok === 0 ? 1 : 0);
