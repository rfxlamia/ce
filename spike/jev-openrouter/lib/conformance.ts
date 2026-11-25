/** Shape check of a Jev answer against the documented SDK_Types (noul, choice, score, box). */

export type AnswerType = 'noul' | 'choice' | 'score' | 'box';

export interface ConformanceEntry {
  field: string;
  expectedType: string;
  observedValue: unknown;
}

type Check = (v: unknown) => boolean;

const isNumber: Check = (v) => typeof v === 'number' && Number.isFinite(v);
const isString: Check = (v) => typeof v === 'string';
const isNullableNumber: Check = (v) => v === null || isNumber(v);
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isNumberMap: Check = (v) => isRecord(v) && Object.values(v).every(isNumber);
const isLegend: Check = (v) =>
  isRecord(v) &&
  Object.values(v).every((x) => typeof x === 'string' || (typeof x === 'object' && x !== null));

interface FieldSpec {
  field: string;
  expectedType: string;
  ok: Check;
}

const BOX_EDGES = ['top', 'bottom', 'left', 'right'] as const;

const SPECS: Record<AnswerType, FieldSpec[]> = {
  noul: [{ field: 'noul', expectedType: 'number', ok: isNumber }],
  choice: [
    { field: 'choice', expectedType: 'string', ok: isString },
    { field: 'confidence', expectedType: 'number', ok: isNumber },
    { field: 'probabilities', expectedType: 'Record<string, number>', ok: isNumberMap },
  ],
  score: [
    { field: 'score', expectedType: 'number', ok: isNumber },
    { field: 'confidence', expectedType: 'number', ok: isNumber },
    { field: 'legend', expectedType: 'Record<string, string | object | array>', ok: isLegend },
    { field: 'probabilities', expectedType: 'Record<string, number>', ok: isNumberMap },
  ],
  box: [{ field: 'confidence', expectedType: 'number | null', ok: isNullableNumber }],
};

/**
 * Compare an answer to the expected shape for `type`.
 * Returns one entry per missing, wrong-typed, or out-of-range field (empty when conformant).
 * A missing field has `observedValue: undefined`.
 */
export function diffAnswer(type: AnswerType, answer: unknown): ConformanceEntry[] {
  if (!isRecord(answer)) {
    return [{ field: '(answer)', expectedType: 'object', observedValue: answer }];
  }
  const entries: ConformanceEntry[] = [];

  if (answer.type !== type) {
    entries.push({ field: 'type', expectedType: `"${type}"`, observedValue: answer.type });
  }

  for (const spec of SPECS[type]) {
    if (!spec.ok(answer[spec.field])) {
      entries.push({
        field: spec.field,
        expectedType: spec.expectedType,
        observedValue: answer[spec.field],
      });
    }
  }

  if (type === 'box') {
    const box = answer.box;
    if (!isRecord(box)) {
      entries.push({
        field: 'box',
        expectedType: '{ top, bottom, left, right: number 0-1 }',
        observedValue: box,
      });
    } else {
      for (const edge of BOX_EDGES) {
        const v = box[edge];
        if (!isNumber(v) || (v as number) < 0 || (v as number) > 1) {
          entries.push({
            field: `box.${edge}`,
            expectedType: 'number in [0, 1]',
            observedValue: v,
          });
        }
      }
    }
  }

  return entries;
}
