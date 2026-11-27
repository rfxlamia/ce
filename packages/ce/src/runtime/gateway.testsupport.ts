// Test support for the runtime loop. Not a test file (vitest only collects *.test.ts).
// No network call, no API key.
//
// `FakeJevGateway` matches a request by the hash of its state. A rendered screenshot is not
// byte-stable across machines, so the Final_Image_Request cannot be recorded that way. This
// wrapper answers the Final_Image_Request by question id (`runtime.state_reached`,
// `runtime.locate_subject`) and never reads image bytes. Every other request is delegated to the
// inner gateway (by default a `FakeJevGateway` with the recordings passed in).

import { JevImageError } from '../jev/errors.js';
import { FakeJevGateway } from '../jev/fake.js';
import type { Recording } from '../jev/fake.js';
import { isImageRequest } from '../jev/gateway.js';
import type { AskOptions, JevGateway, Jev_Response } from '../jev/gateway.js';
import type { Jev_Request } from '../jev/types.js';

export const STATE_REACHED_ID = 'runtime.state_reached';
export const LOCATE_SUBJECT_ID = 'runtime.locate_subject';

export interface SubjectBoxAnswer {
  top: number;
  bottom: number;
  left: number;
  right: number;
  confidence: number | null;
}

export interface FinalImageAnswer {
  /** Probability returned for `state_reached`. Default 0.9. */
  stateReached?: number;
  /** Box returned for `locate_subject`. Default: the centre quarter of the screenshot. */
  box?: SubjectBoxAnswer;
  /** Dated model id returned with the answer. */
  model?: string;
  /** Raise a `JevImageError` instead of answering. `'multipart-400'` mimics OpenRouter's 400. */
  failure?: 'multipart-400' | 'timeout' | 'rate-limit' | JevImageError;
}

/** One request seen by the wrapper. Holds no image bytes and no state text. */
export interface RecordedRequest {
  /** Zero-based position among all requests. */
  index: number;
  stage: Jev_Request['stage'];
  /** Question names in the request, in order. */
  questionNames: string[];
  /** Question ids (`runtime.next_action`, ...) in the same order. */
  questionIds: string[];
  /** True when the request carries an image anywhere (state or question). */
  hasImage: boolean;
  /** True when the request is the combined `state_reached` + `locate_subject` request. */
  isFinalImageRequest: boolean;
  /** Whether the call raised an error. */
  failed: boolean;
}

export interface GatewayTestSupportOptions {
  /** Recordings for text requests, used when `inner` is not given. */
  recordings?: Recording[];
  /** Gateway for non-image requests. Default: `new FakeJevGateway(recordings)`. */
  inner?: JevGateway;
  finalImage?: FinalImageAnswer;
}

const DEFAULT_MODEL = 'typesafe/jev-1.14-test';
const DEFAULT_BOX: SubjectBoxAnswer = { top: 0.25, bottom: 0.75, left: 0.25, right: 0.75, confidence: 0.9 };

export class GatewayTestSupport implements JevGateway {
  readonly requests: RecordedRequest[] = [];
  finalImage: FinalImageAnswer;

  readonly #inner: JevGateway;

  constructor(options: GatewayTestSupportOptions = {}) {
    this.#inner = options.inner ?? new FakeJevGateway(options.recordings ?? []);
    this.finalImage = options.finalImage ?? {};
  }

  /** Requests that carried an image. */
  get imageRequests(): RecordedRequest[] {
    return this.requests.filter((r) => r.hasImage);
  }

  /** Requests that carried no image. */
  get textRequests(): RecordedRequest[] {
    return this.requests.filter((r) => !r.hasImage);
  }

  /** The combined Final_Image_Request(s). Tests assert there is at most one. */
  get finalImageRequests(): RecordedRequest[] {
    return this.requests.filter((r) => r.isFinalImageRequest);
  }

  async ask(request: Jev_Request, options: AskOptions = {}): Promise<Jev_Response> {
    const ids = Object.values(request.questions).map((q) => q.id);
    const record: RecordedRequest = {
      index: this.requests.length,
      stage: request.stage,
      questionNames: Object.keys(request.questions),
      questionIds: ids,
      hasImage: isImageRequest(request),
      isFinalImageRequest:
        ids.length === 2 && ids.includes(STATE_REACHED_ID) && ids.includes(LOCATE_SUBJECT_ID),
      failed: false,
    };
    this.requests.push(record);

    try {
      if (!record.hasImage) return await this.#inner.ask(request, options);
      return this.#answerImage(request, options);
    } catch (error) {
      record.failed = true;
      throw error;
    }
  }

  #answerImage(request: Jev_Request, options: AskOptions): Jev_Response {
    if (options.signal?.aborted === true) throw new JevImageError('timeout');
    const config = this.finalImage;
    const failure = config.failure;
    if (failure instanceof JevImageError) throw failure;
    if (failure === 'multipart-400') {
      throw new JevImageError('bad_request', {
        status: 400,
        message: 'invalid content-type: multipart/form-data',
      });
    }
    if (failure === 'timeout') throw new JevImageError('timeout');
    if (failure === 'rate-limit') throw new JevImageError('rate_limited', { status: 429 });

    const answers: Jev_Response['answers'] = {};
    for (const [name, built] of Object.entries(request.questions)) {
      if (built.id === STATE_REACHED_ID) {
        answers[name] = { type: 'noul', noul: config.stateReached ?? 0.9 };
      } else if (built.id === LOCATE_SUBJECT_ID) {
        const box = config.box ?? DEFAULT_BOX;
        answers[name] = {
          type: 'box',
          box: { top: box.top, bottom: box.bottom, left: box.left, right: box.right },
          confidence: box.confidence,
        };
      } else {
        throw new Error(`GatewayTestSupport: no image answer for question id ${built.id}`);
      }
    }
    return {
      model: config.model ?? DEFAULT_MODEL,
      answers,
      usage: { input_tokens: 0, output_tokens: 0 },
    };
  }
}
