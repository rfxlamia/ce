import { describe, expect, it } from 'vitest';
import { CATALOG, finalImageQuestions } from '../jev/catalog.js';
import { JevImageError } from '../jev/errors.js';
import { stateHash } from '../jev/hash.js';
import type { Jev_Request } from '../jev/types.js';
import { GatewayTestSupport } from './gateway.testsupport.js';

const textRequest = (state: string): Jev_Request => ({
  stage: 'runtime',
  state,
  questions: { state_reached_dom: CATALOG.runtimeStateReachedDom.built() },
});

describe('GatewayTestSupport', () => {
  it('answers the Final_Image_Request by question id, whatever the image bytes', async () => {
    const gateway = new GatewayTestSupport({
      finalImage: { stateReached: 0.8, box: { top: 0.1, bottom: 0.2, left: 0.3, right: 0.4, confidence: 0.5 } },
    });
    const a = await gateway.ask(finalImageQuestions('claim', new Uint8Array([1, 2, 3])));
    const b = await gateway.ask(finalImageQuestions('claim', new Uint8Array([9, 9])));
    for (const result of [a, b]) {
      expect(result.answers['state_reached']).toEqual({ type: 'noul', noul: 0.8 });
      expect(result.answers['locate_subject']).toEqual({
        type: 'box',
        box: { top: 0.1, bottom: 0.2, left: 0.3, right: 0.4 },
        confidence: 0.5,
      });
    }
    expect(gateway.finalImageRequests).toHaveLength(2);
  });

  it('raises JevImageError for the multipart 400 and records the failed call', async () => {
    const gateway = new GatewayTestSupport({ finalImage: { failure: 'multipart-400' } });
    const error = await gateway
      .ask(finalImageQuestions('claim', new Uint8Array([1])))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(JevImageError);
    expect((error as JevImageError).reason).toBe('bad_request');
    expect((error as JevImageError).status).toBe(400);
    expect(gateway.requests[0]?.failed).toBe(true);
  });

  it('delegates text requests to the inner fake and records names without images', async () => {
    const gateway = new GatewayTestSupport({
      recordings: [
        {
          idVersion: 'runtime.state_reached_dom@1',
          stateHash: stateHash('s'),
          question: 'state_reached_dom',
          answer: { type: 'noul', noul: 0.2 },
        },
      ],
    });
    const result = await gateway.ask(textRequest('s'));
    expect(result.answers['state_reached_dom']).toEqual({ type: 'noul', noul: 0.2 });
    expect(gateway.requests).toHaveLength(1);
    expect(gateway.requests[0]).toMatchObject({
      questionNames: ['state_reached_dom'],
      questionIds: ['runtime.state_reached_dom'],
      hasImage: false,
      isFinalImageRequest: false,
      failed: false,
    });
    expect(gateway.imageRequests).toHaveLength(0);
    expect(gateway.textRequests).toHaveLength(1);
  });
});
