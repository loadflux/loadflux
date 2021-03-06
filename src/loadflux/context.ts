import { cloneDeep } from 'lodash';
import { DefaultHttp, Http } from './http';
import { Meter } from './meter';
import { Runner, DefaultRunner } from './runner';
import { Scenario } from './scenario';
import { render, Template } from './template';
import { VU } from './vu';

export interface Context {
  vars: { [key: string]: any };
  env: { [key: string]: string | number };
  cookie(name: string, value: string | Template): void;
}

/**
 * Context is used for sharing data between actions within the scope of a scenario,
 * at the same time, it also provides the facility of action-local variables
 */
export class ActionContext implements Context {
  vars: { [key: string]: any };
  env: { [key: string]: string | number };
  vu: VU;
  scenario: Scenario;
  runner: DefaultRunner;

  meter: Meter;
  http: Http;

  constructor(
    runner: Runner,
    vu: VU,
    scenario: Scenario,
    http: Http = new DefaultHttp(),
  ) {
    // who and what
    this.vu = vu;
    this.scenario = scenario;

    this.http = http;

    // populate from runner
    this.runner = runner as DefaultRunner;
    this.meter = this.runner.meter;
    this.env = this.runner.env;

    // action local, but could be shared to next action for non-parallel actions
    this.vars = {};
  }

  /**
   * we have to clone vars to fit the parallel actions
   */
  clone() {
    const clone = new ActionContext(
      this.runner,
      this.vu,
      this.scenario,
      this.http,
    );
    clone.vars = cloneDeep(this.vars);
    return clone;
  }

  renderTemplate(template: Template) {
    const model = { ...this.vars, env: this.env };
    return render(template, model);
  }

  cookie(name: string, value: string | Template): void {
    this.http.cookie(name, this.renderTemplate(value));
  }
}
