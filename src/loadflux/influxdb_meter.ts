import { Client } from '@influxdata/influx';
import { BucketRetentionRules, IBucket } from '@influxdata/influx/dist';
import { Env } from './env';
import { Request, Response } from './http';
import { Logger } from './log';
import {
  ErrorFields,
  FailureFields,
  Fields,
  Metrics,
  RequestFields,
  ResponseFields,
  SuccessFields,
  VUFields,
} from './metrics';
import { getEnv, KV } from './util';

// ----- This is a hack as InfluxDB client seems to require browser environment ----
// @ts-ignore
import { XMLHttpRequest } from 'xmlhttprequest';
// @ts-ignore
global.XMLHttpRequest = XMLHttpRequest;
// --------------------------------------------------------------------------------

export class Meter {
  client: Client;
  org: string;
  bucket: string;
  api: string;
  logger = new Logger('loadflux:meter');

  bucketExisted!: Promise<IBucket>;
  verboseMetrics = false;

  constructor() {
    this.org = getEnv(Env.LOADFLUX_INFLUXDB_ORG, '');
    this.bucket = getEnv(Env.LOADFLUX_TEST_ID, String(Date.now()));
    this.api = getEnv(Env.LOADFLUX_INFLUXDB_API, '');

    if (!this.org || !this.bucket || !this.api) {
      console.warn(
        'LOADFLUX_INFLUXDB_ORG or LOADFLUX_INFLUXDB_API or LOADFLUX_TEST_ID is not set',
      );
      process.exit(-1);
    }
    this.client = new Client(this.api, getEnv(Env.LOADFLUX_INFLUXDB_TOKEN, ''));
    this.createBucketIfNotExist();
    this.verboseMetrics =
      getEnv<string>(Env.LOADFLUX_VERBOSE_METRICS, 'false') === 'true';
  }

  private createBucketIfNotExist() {
    this.bucketExisted = new Promise<IBucket>((resolve, reject) => {
      const createBucket = () => {
        this.client.buckets
          .create({
            orgID: this.org,
            name: this.bucket,
            retentionRules: [
              {
                type: BucketRetentionRules.TypeEnum.Expire,
                everySeconds: 3 * 24 * 3600,
              },
            ],
          })
          .then((bucket: IBucket) => {
            this.logger.log('created a bucket');
            resolve(bucket);
          })
          .catch((err) => {
            this.logger.log('create bucket failed', err);
            reject();
          });
      };

      this.client.buckets
        .getAll(this.org)
        .then((buckets: IBucket[]) => {
          const bucket = buckets.find((bucket) => bucket.name === this.bucket);
          if (bucket) {
            this.logger.log('bucket exists');
            resolve(bucket);
          } else {
            this.logger.log('bucket does not exist');
            createBucket();
          }
        })
        .catch((err) => {
          this.logger.log('list buckets failed, try to create one');
          createBucket();
        });
    });
  }

  private publish(
    measurement: Metrics,
    fields: Fields,
    timestamp?: number,
    tags?: KV,
  ) {
    // 'mem,host=host1 used_percent=23.43234543 1556896326'; // Line protocol string
    this.bucketExisted
      .then(() => {
        const data = this.build(measurement, fields, tags, timestamp);
        this.logger.log(data);
        this.client.write.create(this.org, this.bucket, data).catch((e) => {
          this.logger.log('Error occurred when sending ops', e);
        });
      })
      .catch((e) => {
        this.logger.log('Error when getting or creating a bucket');
      });
  }

  publishHttpReq(request: Request, vu: number) {
    this.publish(Metrics.REQUEST, {
      count: 1,
      method: request.method,
      url: request.url,
      vu,
    } as RequestFields);
  }

  publishHttpRes(response: Response<any>, vu: number) {
    this.publish(Metrics.RESPONSE, {
      count: 1,
      method: response.request.method,
      url: response.request.url,
      wait: response.timings.wait,
      dns: response.timings.dns,
      tcp: response.timings.tcp,
      tls: 0,
      request: response.timings.request,
      firstByte: response.timings.firstByte,
      download: response.timings.download,
      total: response.timings.total,
      status_code: response.status,
    } as ResponseFields);
  }

  publishHttpOk(response: Response<any>) {
    this.publish(Metrics.SUCCESS, {
      count: 1,
      method: response.request.method,
      url: response.request.url,
      status_code: response.status,
    } as SuccessFields);
  }

  publishHttpKo(response: Response<any>, e: Error) {
    this.publish(Metrics.FAILURE, {
      count: 1,
      method: response.request.method,
      url: response.request.url,
      status_code: response.status,
      error: e.message,
    } as FailureFields);
  }

  publishHttpErr(request: Request, e: Error) {
    this.publish(Metrics.ERROR, {
      count: 1,
      method: request.method,
      url: request.url,
      error: e.message,
    } as ErrorFields);
  }

  publishVu(vu: number) {
    this.publish(Metrics.VU, { active: vu } as VUFields);
  }

  // <measurement>[,<tag_key>=<tag_value>[,<tag_key>=<tag_value>]] <field_key>=<field_value>[,<field_key>=<field_value>] [<timestamp>]
  private build(
    measurement: Metrics,
    fields: Fields,
    tags?: KV,
    timestamp?: number,
  ) {
    let joinedTags = '';
    if (tags) {
      joinedTags = Object.entries(tags)
        .map(([key, value]) => `${key}=${this.quoteIfNeed(value)}`)
        .join(',');
    }
    const extraTags = getEnv(Env.LOADFLUX_INFLUXDB_TAGS, '');
    if (extraTags) {
      joinedTags += `,${extraTags}`;
    }
    let joinedFields = '';
    if (fields) {
      joinedFields = Object.entries(fields)
        // @ts-ignore
        .filter(([key, value]) => this.isNumeric(value) || this.verboseMetrics)
        // @ts-ignore
        .map(([key, value]) => `${key}=${this.quoteIfNeed(value)}`)
        .join(',');
    }
    return `${measurement}${
      joinedTags ? ',' : ''
    }${joinedTags} ${joinedFields} ${timestamp || this.nanotime()}`.trim();
  }

  private quoteIfNeed(value: string | number) {
    return this.isNumeric(value) ? Number(value) : `"${value}"`;
  }

  // Get the nanoseconds since unix epoch
  private nanotime() {
    if (this.verboseMetrics) {
      // TODO
      return `${Date.now()}000000`;
    }
    return '';
  }

  private isNumeric(value: string | number) {
    // @ts-ignore
    return !isNaN(value);
  }
}
