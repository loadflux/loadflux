import got, { Got, Options, Method } from 'got';
import { mimeExtension } from './mime';
import { Template } from './template';
import { Readable } from 'stream';
import FormData = require('form-data');

export interface RequestCommon {
  url: string | Template;
  method?: Method;
  prefixUrl?: string;
  headers?: any;
  query?: any;
  responseType?: 'default' | 'json' | 'text';
  timeout?: number;
}

export interface BodyRequestPayload {
  body?: string | Buffer | Readable;
}

export interface JsonRequestPayload {
  json?: {
    [key: string]: any;
  };
}

export interface FormRequestPayload {
  form?: { [key: string]: any };
}

export type Request = RequestCommon &
  (BodyRequestPayload | JsonRequestPayload | FormRequestPayload);

export interface Response<T> {
  body: T;
  status: number;
  statusText: string;
  headers: any;
  request: Request;
  // xhr?: XMLHttpRequest;
  timings: {
    wait: number;
    dns: number;
    tcp: number;
    request: number;
    firstByte: number;
    download: number;
    total: number;
  };
}

export class HttpClient {
  instance: Got;

  constructor() {
    this.instance = got.extend({
      mutableDefaults: true,
      rejectUnauthorized: false,
    });
  }

  async request(options: Options): Promise<Response<any>> {
    if (options.body && options.body instanceof FormData) {
      const formData = options.body;
      options.headers = {
        ...options.headers,
        ...formData.getHeaders(),
      };
      options.body = formData.getBuffer();
    }

    // @ts-ignore
    const response: got.Response = await this.instance({
      ...options,
      responseType: options.responseType || 'text',
    });
    // transform response
    return {
      body: options.responseType
        ? response.body
        : mimeExtension(response.headers['content-type'] as string) === 'json'
        ? JSON.parse(response.body)
        : response.body,
      status: response.statusCode,
      statusText: response.statusMessage,
      headers: response.headers,
      request: response.request.options,
      timings: response.timings.phases,
    };
  }

  cookie(name: string, value: string) {
    this.instance.defaults.options.headers.Cookie = `${name}=${value}`;
    this.instance.defaults.options.headers['User-Agent'] = 'Loadflux/Got';
  }
}
