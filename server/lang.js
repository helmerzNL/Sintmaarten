'use strict';
// Taal van de site (instelling in het beheer) en vertaling van teksten die de server zelf verstuurt (pushmeldingen).
const store = require('./store');
const { makeTranslator } = require('../public/js/lang-core');
const dicts = require('../public/js/lang-en');

const LANGS = ['nl', 'en'];
const translators = Object.fromEntries(Object.entries(dicts).map(([k, d]) => [k, makeTranslator(d)]));

const multilingual = () => store.db().settings?.multilingual === true;
const defaultLang = () => { const l = store.db().settings?.defaultLang; return LANGS.includes(l) ? l : 'nl'; };
// Vertaalt een Nederlandse tekst naar de standaardtaal van de site (voor meldingen aan de beheerder).
const tr = (s) => (translators[defaultLang()] ? translators[defaultLang()].tr(s) : s);
// Sjabloon met variabelen, bijvoorbeeld t('{n} berichten', { n: 3 }).
const t = (tpl, vars) => {
  const x = translators[defaultLang()];
  return x ? x.t(tpl, vars) : tpl.replace(/\{(\w+)\}/g, (m, n) => (vars && n in vars ? String(vars[n]) : m));
};

module.exports = { LANGS, multilingual, defaultLang, tr, t };
