import { describe, it, expect } from 'vitest';
import { rawJsonSystemOne, RawHttpError } from './raw.js';

const base = {
  model: 'm',
  state: 's <shot>',
  questions: { box: { type: 'box' as const, instructions: 'q' } },
  placeholder: '<shot>',
  pngBase64: 'AAAA',
  env: { OPENROUTER_API_KEY: 'k' } as NodeJS.ProcessEnv,
};

describe('rawJsonSystemOne', () => {
  it('sends a JSON body with a data_base64 asset and the images header only when asked', async () => {
    let seen: { headers: Record<string, string>; body: any } | undefined;
    const fetchFn = (async (_u: string, init: any) => {
      seen = { headers: init.headers, body: JSON.parse(init.body) };
      return new Response(JSON.stringify({ model: 'x', answers: {} }), { status: 200 });
    }) as unknown as typeof fetch;
    await rawJsonSystemOne({ ...base, imagesHeader: true, fetchFn });
    expect(seen?.headers['TypeSafe-Danger-Zone-Images']).toBe('true');
    expect(seen?.body.assets['<shot>']).toEqual({ type: 'image', format: 'png', data_base64: 'AAAA' });
    await rawJsonSystemOne({ ...base, imagesHeader: false, fetchFn });
    expect(seen?.headers['TypeSafe-Danger-Zone-Images']).toBeUndefined();
  });
  it('throws RawHttpError with status and parsed body on failure', async () => {
    const fetchFn = (async () => new Response(JSON.stringify({ detail: 'nope' }), { status: 400 })) as unknown as typeof fetch;
    const err = await rawJsonSystemOne({ ...base, imagesHeader: true, fetchFn }).catch((e) => e);
    expect(err).toBeInstanceOf(RawHttpError);
    expect(err).toMatchObject({ status: 400, body: { detail: 'nope' } });
  });
});
