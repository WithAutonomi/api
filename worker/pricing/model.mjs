// Source-independent prototype contract: docs/specs/pricing-prototype.md.
// Assumes one upload, all chunks payable; excludes DataMap overhead,
// deduplication, runtime fallback and wallet-allowance approvals.
export const MODEL = Object.freeze({
  calculation_id: 'inventory-pricing-prototype',
  calculation_version: '2',
  client_version: '0.3.6',
  client_revision: 'dbc01ce8fdbdfe9ac4d064d35f36b4684bf6a616',
  source_chunk_bytes: '4190208',
  min_source_bytes: '3',
  min_chunks: '3',
  auto_batch_min_chunks: '64',
  single_wave_max_chunks: '64',
  batch_max_leaves: '256',
  max_source_bytes: '1000000000000000',
  max_amount_digits: '13',
  amount_unit_bytes: Object.freeze({
    KB: '1000',
    MB: '1000000',
    GB: '1000000000',
    TB: '1000000000000',
  }),
});

const CHUNK_BYTES = BigInt(MODEL.source_chunk_bytes);
const MAX_BYTES = BigInt(MODEL.max_source_bytes);
const MIN_BYTES = BigInt(MODEL.min_source_bytes);
const MIN_CHUNKS = BigInt(MODEL.min_chunks);
const BATCH_THRESHOLD = BigInt(MODEL.auto_batch_min_chunks);
const SINGLE_WAVE = BigInt(MODEL.single_wave_max_chunks);
const BATCH_CAP = BigInt(MODEL.batch_max_leaves);

export function amountToBytes(amount, unit) {
  if (typeof amount !== 'string' || amount.length > Number(MODEL.max_amount_digits)
      || amount.trim() !== amount || !/^[1-9][0-9]*$/.test(amount)) {
    throw new TypeError('amount must be canonical positive integer text of at most 13 digits');
  }
  if (typeof unit !== 'string' || !Object.hasOwn(MODEL.amount_unit_bytes, unit)) {
    throw new TypeError('unit must be KB, MB, GB or TB');
  }
  const bytes = BigInt(amount) * BigInt(MODEL.amount_unit_bytes[unit]);
  if (bytes > MAX_BYTES) throw new RangeError('amount exceeds the prototype byte limit');
  return bytes;
}

export function summarizeUpload(bytes, mode = 'auto') {
  if (typeof bytes !== 'bigint') throw new TypeError('bytes must be a BigInt');
  if (bytes < MIN_BYTES || bytes > MAX_BYTES) {
    throw new RangeError('bytes must be between 3 and the prototype byte limit');
  }
  if (mode !== 'auto' && mode !== 'single' && mode !== 'batch') {
    throw new TypeError('mode must be auto, single or batch');
  }

  const sourceChunks = (bytes + CHUNK_BYTES - 1n) / CHUNK_BYTES;
  const chunks = sourceChunks < MIN_CHUNKS ? MIN_CHUNKS : sourceChunks;
  const method = mode === 'auto' ? (chunks >= BATCH_THRESHOLD ? 'batch' : 'single') : mode;
  let billedUnits = chunks;
  let transactions = (chunks + SINGLE_WAVE - 1n) / SINGLE_WAVE;
  let batchSummary = null;

  if (method === 'batch') {
    const full = chunks / BATCH_CAP;
    const tail = chunks % BATCH_CAP;
    const rebalanced = tail === 1n;
    let fullBatches = full;
    let tailLeaves = tail;
    billedUnits = full * BATCH_CAP;
    transactions = full;

    if (rebalanced) {
      // Replace the final (256, 1) pair with (255, 2), billed as (256, 2).
      fullBatches = full - 1n;
      tailLeaves = 0n;
      billedUnits += 2n;
      transactions += 1n;
    } else if (tail > 0n) {
      let padded = 1n;
      // At most eight doublings, regardless of upload size.
      while (padded < tail) padded *= 2n;
      billedUnits += padded;
      transactions += 1n;
    }

    batchSummary = {
      full_batches: fullBatches.toString(),
      tail_leaves: tailLeaves.toString(),
      rebalanced_tail: rebalanced,
    };
  }

  return {
    selected_bytes: bytes.toString(),
    chunks: chunks.toString(),
    method,
    billed_units: billedUnits.toString(),
    billing_unit: method === 'single' ? 'chunk' : 'batch_leaf',
    payment_transactions: transactions.toString(),
    batch_summary: batchSummary,
  };
}

function parseDecimal(value, name, maxLength) {
  if (typeof value !== 'string' || value.length > maxLength
      || value.trim() !== value || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value)) {
    throw new TypeError(`${name} must be unsigned decimal text of at most ${maxLength} characters`);
  }
  const [integer, fraction = ''] = value.split('.');
  return { coefficient: BigInt(integer + fraction), scale: fraction.length };
}

function parseRate(value, name) {
  const decimal = parseDecimal(value, name, 49);
  const integerDigits = value.length - (decimal.scale === 0 ? 0 : decimal.scale + 1);
  if (integerDigits > 24 || decimal.scale > 24 || decimal.coefficient === 0n) {
    throw new RangeError(`${name} must be positive with at most 24 integer and 24 fractional digits`);
  }
  return decimal;
}

function requireRecord(value, name) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
}

function multiply(left, right) {
  return { coefficient: left.coefficient * right.coefficient, scale: left.scale + right.scale };
}

function add(left, right) {
  const scale = Math.max(left.scale, right.scale);
  return {
    coefficient: left.coefficient * 10n ** BigInt(scale - left.scale)
      + right.coefficient * 10n ** BigInt(scale - right.scale),
    scale,
  };
}

function decimalText(decimal) {
  if (decimal === null) return null;
  const { coefficient, scale } = decimal;
  if (scale === 0) return coefficient.toString();
  const digits = coefficient.toString().padStart(scale + 1, '0');
  const integer = digits.slice(0, -scale);
  const fraction = digits.slice(-scale).replace(/0+$/, '');
  return fraction ? `${integer}.${fraction}` : integer;
}

export function estimateStorage(bytes, rates, mode = 'auto') {
  const summary = summarizeUpload(bytes, mode);
  requireRecord(rates, 'rates');
  const single = parseRate(rates.single_ant_per_chunk, 'single_ant_per_chunk');
  const batch = parseRate(rates.batch_ant_per_leaf, 'batch_ant_per_leaf');
  const rate = summary.method === 'single' ? single : batch;
  return {
    ...summary,
    storage_ant: decimalText(multiply(rate, { coefficient: BigInt(summary.billed_units), scale: 0 })),
  };
}

// Observed provider gas is per billed unit, not per payment transaction.
export function estimateUpload(bytes, rates, mode = 'auto') {
  const storage = estimateStorage(bytes, rates, mode);
  const single = parseRate(rates.single_eth_per_chunk, 'single_eth_per_chunk');
  const batch = parseRate(rates.batch_eth_per_leaf, 'batch_eth_per_leaf');
  const rate = storage.method === 'single' ? single : batch;
  return {
    ...storage,
    transaction_fee_eth: decimalText(multiply(rate, { coefficient: BigInt(storage.billed_units), scale: 0 })),
  };
}

export function convertToUsd(storageAnt, transactionFeeEth, exchange) {
  requireRecord(exchange, 'exchange');
  const storage = storageAnt === null ? null : parseDecimal(storageAnt, 'storageAnt', 64);
  const fee = transactionFeeEth === null ? null : parseDecimal(transactionFeeEth, 'transactionFeeEth', 64);
  const ant = exchange.ant_usd === null ? null : parseRate(exchange.ant_usd, 'ant_usd');
  const eth = exchange.eth_usd === null ? null : parseRate(exchange.eth_usd, 'eth_usd');
  const storageUsd = storage === null || ant === null ? null : multiply(storage, ant);
  const feeUsd = fee === null || eth === null ? null : multiply(fee, eth);
  return {
    storage_usd: decimalText(storageUsd),
    transaction_fee_usd: decimalText(feeUsd),
    total_usd: storageUsd === null || feeUsd === null ? null : decimalText(add(storageUsd, feeUsd)),
  };
}

export function formatUsd(value) {
  const { coefficient, scale } = parseDecimal(value, 'value', 256);
  const sourceFactor = 10n ** BigInt(scale);
  // Choose the band using the original value, not an already rounded display.
  const places = coefficient >= 100n * sourceFactor ? 0 : coefficient * 10n < sourceFactor ? 3 : 2;
  let rounded;
  if (scale > places) {
    const divisor = 10n ** BigInt(scale - places);
    rounded = (coefficient + divisor / 2n) / divisor;
  } else {
    rounded = coefficient * 10n ** BigInt(places - scale);
  }
  const displayFactor = 10n ** BigInt(places);
  const integer = (rounded / displayFactor).toLocaleString('en-US');
  const fraction = places === 0 ? '' : `.${(rounded % displayFactor).toString().padStart(places, '0')}`;
  return `$${integer}${fraction}`;
}
