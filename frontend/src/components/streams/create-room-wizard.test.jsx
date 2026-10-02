import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  globalThis.localStorage = { getItem: () => null, setItem: () => {} };
  globalThis.document = { documentElement: { lang: '' } };
  globalThis.self = globalThis;
  Object.defineProperty(globalThis, 'navigator', { value: { language: 'zh-CN' }, configurable: true });
});
vi.mock('sonner', () => ({ toast: { success: () => {}, error: () => {}, warning: () => {} } }));
vi.mock('../../lib/api', () => ({ api: { post: vi.fn().mockResolvedValue({}), get: vi.fn().mockResolvedValue([]) } }));

import { MemoryRouter } from 'react-router-dom';
import '../../i18n';
import i18n from '../../i18n';
import CreateRoomWizard, { WizardAbandonedNotice, WizardCompletion, WizardFailure } from './CreateRoomWizard';

const t = i18n.getFixedT(null, 'streams');

const baseForm = {
  name: '任意社会学',
  remark: '晚间场',
  businessUnit: '新闻中心',
  protocol: 'rtmp',
  inputDirection: 'IN_PUSH',
  pullSource: { name: '', source_url: '', protocol: 'rtmp' },
  outputs: [],
  createRunPlan: true
};

describe('create room wizard steps', () => {
  it('step 1 collects identity fields with shared name semantics', () => {
    const html = renderToStaticMarkup(<MemoryRouter><CreateRoomWizard open onClose={() => {}} initialStep={0} initialForm={baseForm} /></MemoryRouter>);
    expect(html).toContain('基本信息');
    expect(html).toContain('备注');
    expect(html).toContain('业务归属');
    expect(html).toContain('下一步');
    expect(html).toContain('任意社会学');
  });

  it('step 2 offers the two input directions with unified copy', () => {
    const html = renderToStaticMarkup(<MemoryRouter><CreateRoomWizard open onClose={() => {}} initialStep={1} initialForm={baseForm} /></MemoryRouter>);
    expect(html).toContain('第三方推给我们');
    expect(html).toContain('我们主动拉第三方');
  });

  it('step 3 warns about one-time ingest credentials for IN_PUSH', () => {
    const html = renderToStaticMarkup(<MemoryRouter><CreateRoomWizard open onClose={() => {}} initialStep={2} initialForm={baseForm} /></MemoryRouter>);
    expect(html).toContain('创建完成后发放一次性推流凭据');
  });

  it('step 3 collects the pull source for IN_PULL', () => {
    const html = renderToStaticMarkup(<MemoryRouter><CreateRoomWizard open onClose={() => {}} initialStep={2} initialForm={{ ...baseForm, inputDirection: 'IN_PULL' }} /></MemoryRouter>);
    expect(html).toContain('拉流地址');
    expect(html).toContain('拉流协议');
  });

  it('step 4 states the zero-output monitoring room contract', () => {
    const html = renderToStaticMarkup(<MemoryRouter><CreateRoomWizard open onClose={() => {}} initialStep={3} initialForm={baseForm} /></MemoryRouter>);
    expect(html).toContain('本地输出');
    expect(html).toContain('本场无分发/录制输出');
  });

  it('step 4 shows selected scenes with their push target field', () => {
    const html = renderToStaticMarkup(<MemoryRouter><CreateRoomWizard open onClose={() => {}} initialStep={3}
      initialForm={{ ...baseForm, outputs: [
        { sceneId: 'LOCAL_RECORD', target_url: '' },
        { sceneId: 'LIVE_PLATFORM_PUSH', transport: 'rtmp', target_url: 'rtmp://cdn.example/live/key' },
        { sceneId: 'PARTNER_PULL', target_url: '' }
      ] }} /></MemoryRouter>);
    expect(html).toContain('第三方拉我们的输出');
    expect(html).toContain('我们推给第三方');
    expect(html).toContain('rtmp://cdn.example/live/key');
    expect(html).not.toContain('本场无分发/录制输出');
  });

  it('step 5 renders the summary for an IN_PULL room with outputs', () => {
    const html = renderToStaticMarkup(<MemoryRouter><CreateRoomWizard open onClose={() => {}} initialStep={4}
      initialForm={{ ...baseForm, inputDirection: 'IN_PULL', pullSource: { name: '合作方演播室', source_url: 'rtmp://up/live/a', protocol: 'rtmp' }, outputs: [{ sceneId: 'PARTNER_PULL', target_url: '' }] }} /></MemoryRouter>);
    expect(html).toContain('我们主动拉第三方');
    expect(html).toContain('rtmp://up/live/a');
    expect(html).toContain('输出 1 个');
  });

  it('step 5 shows the precheck summary and zero-output plan notice', () => {
    const html = renderToStaticMarkup(<MemoryRouter><CreateRoomWizard open onClose={() => {}} initialStep={4} initialForm={baseForm} /></MemoryRouter>);
    expect(html).toContain('预检清单');
    expect(html).toContain('创建开播方案并运行预检');
    expect(html).toContain('创建并进入工作台');
  });
});

describe('wizard completion view (one-time credential + preflight)', () => {
  it('shows the credential plaintext exactly once with the copy-again warning', () => {
    const journal = {
      credential_display: {
        token: 'tok_abc123',
        server_url: 'rtmp://srs.example/live',
        stream_key: '任意社会学?ingest_token=tok_abc123',
        publish_url: 'rtmp://srs.example/live/任意社会学?ingest_token=tok_abc123'
      },
      credential_recovered: false,
      preflight: { status: 'READY', summary: null }
    };
    const html = renderToStaticMarkup(<WizardCompletion journal={journal} outputsCount={0} t={t} />);
    expect(html).toContain('一次性推流凭据');
    expect(html).toContain('仅此一次展示');
    expect(html).toContain('tok_abc123');
    expect(html).toContain('rtmp://srs.example/live/任意社会学');
    expect(html).toContain('预检状态：就绪');
    expect(html).toContain('本场无分发/录制输出');
  });

  it('never re-exposes a token when the credential response was lost', () => {
    const journal = { credential_display: null, credential_recovered: true, preflight: null };
    const html = renderToStaticMarkup(<WizardCompletion journal={journal} outputsCount={2} t={t} />);
    expect(html).toContain('凭据已发放，但令牌未能送达');
    expect(html).toContain('无法重新展示');
    expect(html).not.toContain('tok_');
    expect(html).not.toContain('一次性推流凭据'); // no plaintext panel at all
  });

  it('surfaces a READY_WITH_WARNING preflight with counts', () => {
    const journal = {
      credential_display: null,
      credential_recovered: false,
      preflight: { status: 'READY_WITH_WARNING', summary: { warnings: 2, blockers: 0 } }
    };
    const html = renderToStaticMarkup(<WizardCompletion journal={journal} outputsCount={1} t={t} />);
    expect(html).toContain('预检状态：就绪（有告警）');
    expect(html).toContain('2 项告警');
  });
});

describe('wizard failure view (preflight specifics)', () => {
  it('shows the concrete BLOCKED preflight status and blocker count', () => {
    const html = renderToStaticMarkup(<WizardFailure
      failure={{ step: 'preflight', message: 'Request failed with status code 409' }}
      preflight={{ status: 'BLOCKED', summary: { blockers: 2, warnings: 0 } }}
      t={t} />);
    expect(html).toContain('preflight');
    expect(html).toContain('预检状态：被阻断');
    expect(html).toContain('2 项阻断');
    expect(html).toContain('不会重复创建已完成内容'); // recoverHint copy
  });

  it('stays quiet about preflight when the failure is another step', () => {
    const html = renderToStaticMarkup(<WizardFailure
      failure={{ step: 'output:0', message: 'timeout' }}
      preflight={{ status: 'BLOCKED', summary: { blockers: 1 } }}
      t={t} />);
    expect(html).toContain('output:0');
    expect(html).not.toContain('预检状态');
    expect(renderToStaticMarkup(<WizardFailure failure={null} t={t} />)).toBe('');
  });
});

describe('wizard abandon notice (FIX-04 plan A: leftover resources are explicit)', () => {
  it('lists the leftover server resources and states they are not auto-deleted', () => {
    const html = renderToStaticMarkup(<WizardAbandonedNotice
      abandoned={{ name: '任意社会学', streamId: 42, resources: ['stream', 'source', 'outputs'] }}
      t={t} />);
    expect(html).toContain('已放弃上次创建');
    expect(html).toContain('任意社会学');
    expect(html).toContain('直播间');
    expect(html).toContain('外部节目源');
    expect(html).toContain('输出');
    expect(html).toContain('不会被自动删除');
    expect(html).toContain('无法静默回滚');
  });

  it('renders nothing when the abandoned run had created nothing', () => {
    expect(renderToStaticMarkup(<WizardAbandonedNotice abandoned={null} t={t} />)).toBe('');
  });
});
