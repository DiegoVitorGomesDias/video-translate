import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toBrazilian } from '../src/lib/translate/ptbr.ts';

test('estar a + infinitivo vira gerúndio', () => {
  assert.equal(toBrazilian('Estou a tentar descobrir que raio.'), 'Estou tentando descobrir que diabos.');
  assert.equal(toBrazilian('Ela estava a pôr a mesa e eles estão a ir embora.'), 'Ela estava pondo a mesa e eles estão indo embora.');
  assert.equal(toBrazilian('Continuamos a fazer isso.'), 'Continuamos fazendo isso.');
});

test('tu vira você, com verbo e possessivo', () => {
  assert.equal(toBrazilian('Tu tens a certeza? O teu pai sabe que tu fizeste isso?'), 'Você tem a certeza? O seu pai sabe que você fez isso?');
  assert.equal(toBrazilian('Vou contigo.'), 'Vou com você.');
});

test('ênclise vira próclise', () => {
  assert.equal(toBrazilian('Disse-me que sim. Ele viu-a ontem.'), 'Me disse que sim. Ele a viu ontem.');
  assert.equal(toBrazilian('Vamos fazê-lo agora.'), 'Vamos fazê-lo agora.');
});

test('léxico', () => {
  assert.equal(toBrazilian('O ecrã do telemóvel partiu no autocarro.'), 'A tela do celular partiu no ônibus.');
  assert.equal(toBrazilian('Não percebo o facto.'), 'Não entendo o fato.');
});

test('pt-BR fica igual', () => {
  const t = 'Como posso fazer uma punção lombar num paciente com soluços intratáveis? Você está bem.';
  assert.equal(toBrazilian(t), t);
  assert.equal(toBrazilian('A casa é a mesma.'), 'A casa é a mesma.');
  assert.equal(toBrazilian('Ele vai a pé.'), 'Ele vai a pé.');
});

test('planear vira planejar', () => {
  assert.equal(toBrazilian('Ninguém planeia se divorciar. Planeio que o meu marido morra.'), 'Ninguém planeja se divorciar. Planejo que o meu marido morra.');
  assert.equal(toBrazilian('Ele planeou tudo, sem planeamento. O planeta.'), 'Ele planejou tudo, sem planejamento. O planeta.');
});
