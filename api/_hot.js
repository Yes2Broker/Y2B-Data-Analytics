/* ================================================================
   YES2BROKER — api/_hot.js
   Helpers for the hot_leads table (CRM "Activity Report" export).
   Files prefixed with "_" are NOT exposed as routes by Vercel.

   "Activity Details" looks like:
     "Buy: Flat, 3 BHK (Hot), Description: client will convert on 30th june"
   Only descriptions of rows whose status is Hot are grammar-corrected
   (that is all the dashboard shows). The corrected text is stored in the
   "Clean Description" column at upload time, so it is done once per row.
   ================================================================ */

const DETAILS_RE = /^\s*([^:]*):\s*([^,]*),\s*(.*?)\s*\(([^)]*)\)\s*,\s*Description:\s*([\s\S]*)$/;

function parseDetails(s) {
  const m = DETAILS_RE.exec(String(s || ''));
  if (!m) return { propertyFor: '', property: '', bhk: '', status: '', description: '' };
  return {
    propertyFor: m[1].trim(), property: m[2].trim(), bhk: m[3].trim(),
    status: m[4].trim(), description: m[5].trim(),
  };
}

const isHot = details => parseDetails(details).status.toLowerCase() === 'hot';

// Deterministic tidy-up — used when the AI step is unavailable.
function ruleClean(text) {
  let t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  t = t
    .replace(/\s+([.,!?;:])/g, '$1')                 // no space before punctuation
    .replace(/([,;:])(?=[^\s\d])/g, '$1 ')          // space after , ; :
    .replace(/\.(?=[A-Za-z]{2})/g, '. ')            // "done.client" -> "done. client"
    .replace(/\bi\b/g, 'I')                          // lone "i" -> "I"
    .replace(/(\d)\s*bhk\b/gi, '$1 BHK')             // "3bhk" -> "3 BHK"
    .replace(/\bbhk\b/gi, 'BHK')
    .replace(/(\d)\s*cr\b/gi, '$1 Cr');              // "2cr" -> "2 Cr"
  t = t.replace(/(^|[.!?]\s+)([a-z])/g, (_, p, c) => p + c.toUpperCase());
  if (!/[.!?]$/.test(t)) t += '.';
  return t;
}

// Grammar-correct a list of notes with Claude. Returns an array the same
// length as `texts`; falls back to ruleClean for anything it can't fix.
async function aiClean(texts) {
  const out = texts.map(ruleClean);
  if (!texts.length) return out;
  if (!process.env.ANTHROPIC_API_KEY) return out;

  let Anthropic;
  try { const mod = require('@anthropic-ai/sdk'); Anthropic = mod.default || mod; }
  catch (_) { return out; }

  const client = new Anthropic({ maxRetries: 1, timeout: 45_000 });
  const items = texts.map((text, id) => ({ id, text }));

  try {
    const response = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: {
        effort: 'low',
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { id: { type: 'integer' }, text: { type: 'string' } },
                  required: ['id', 'text'],
                  additionalProperties: false,
                },
              },
            },
            required: ['items'],
            additionalProperties: false,
          },
        },
      },
      system:
        'You correct short CRM notes written by real-estate sales staff in India. ' +
        'For each note, fix grammar, spelling, capitalization and punctuation so it reads as clear, ' +
        'natural English. Keep the meaning exactly. Do not add, remove or guess any facts. ' +
        'Keep names, project names, tower/unit numbers (e.g. A-1102, D-601), areas, budgets, ' +
        'amounts and dates as written (you may normalise their formatting, e.g. "3bhk" -> "3 BHK", ' +
        '"2cr" -> "2 Cr"). Keep it short. Return every id exactly once.',
      messages: [{ role: 'user', content: JSON.stringify(items) }],
    });

    if (response.stop_reason !== 'end_turn') return out;
    const textBlock = response.content.find(b => b.type === 'text');
    const parsed = JSON.parse(textBlock ? textBlock.text : '{}');
    (parsed.items || []).forEach(({ id, text }) => {
      if (Number.isInteger(id) && id >= 0 && id < out.length && typeof text === 'string' && text.trim()) {
        out[id] = text.trim();
      }
    });
  } catch (err) {
    console.error('hot_leads grammar correction failed, using basic cleanup:', err && err.message);
  }
  return out;
}

// Fill "Clean Description" on the rows that need it (Hot rows with a note).
async function addCleanDescriptions(rows) {
  const unique = [];
  const index = new Map();
  rows.forEach(r => {
    if (!isHot(r['Activity Details'])) return;
    const d = parseDetails(r['Activity Details']).description;
    if (d && !index.has(d)) { index.set(d, unique.length); unique.push(d); }
  });
  const cleaned = await aiClean(unique);
  rows.forEach(r => {
    // Every row gets the key (PostgREST bulk inserts need identical columns per row)
    const d = isHot(r['Activity Details']) ? parseDetails(r['Activity Details']).description : '';
    r['Clean Description'] = d ? cleaned[index.get(d)] : null;
  });
  return rows;
}

module.exports = { parseDetails, isHot, ruleClean, aiClean, addCleanDescriptions };
