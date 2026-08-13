-- ⚠️ 示范内容，不是系统的一部分。整个 demo/ 装的是一位艺术家的公开作品集，
--    fork 下来请换成你自己的 —— 见 demo/README.md。
--
-- 下面这行是护栏（migration 0059）。这个库里要是真人的数据，整支在这里中止，
-- 一行都不会删。种子必须整支跑在一个事务里，护栏才拦得住后面的 truncate。
select producer.demo_guard();

-- Seed: Hu Di's real works (read from hudiworks.com) + profile (ported from the Claude cron).
-- Idempotent-ish: clears producer.works first so re-running gives a clean库.

truncate producer.works;

-- ── 画像 / profile (from the existing weekly cron's Profile) ──────────────
insert into producer.profile (name, website, is_demo, data)
values (
  'Hu Di',
  'https://hudiworks.com/',
  true,   -- is_demo：模板自带的示范画像（0059）。这个库归你之后，改成 false。
  jsonb_build_object(
    'location',        jsonb_build_array('Los Angeles', 'SF Bay Area'),
    'visa',            'O-1',
    'career_stage',    'emerging',
    'languages',       jsonb_build_array('中文','English'),
    'background',      jsonb_build_array('physics','computer science'),
    'directions',      jsonb_build_array(
                          '装置为主（微缩+日常物、沉浸式、参与式/观众即共同作者）',
                          'AI/新媒体（技术作为材料与批评对象）',
                          '社会介入'),
    'motifs',          jsonb_build_array('被看见','被爱','被理解'),
    'funding_pref',    '偏好带资助，接受少/无资助，可一定程度考虑收费 residency，可国际旅行',
    'exclude_rule',    '限美国公民/绿卡、或需当地工作权的 → 不进主名单（待身份变化 Eligibility Hold）',
    'watch_rule',      '高匹配但当前未开放 → 仍入名单，状态 🟡 关注，记下一轮预计时间',
    'concerns',        jsonb_build_object(
                          'intimacy',        '对爱与亲密的痴望',
                          'systems',         '社会系统结构里的超现实',
                          'body_space_time', '身体/空间/时间的方法实验')
  )
)
on conflict (singleton) do update
  set name = excluded.name, website = excluded.website, data = excluded.data;

-- ── 作品库 / works ───────────────────────────────────────────────────────
insert into producer.works (title, medium, blurb, concern, site_path, sort, box) values
  ('Echo Chamber Realms', '参与式装置', '多智能体 AI 对话，直到依恋、竞争、关怀自己浮现，搬演成观众能照见自身的场。', 'intimacy', '#/echo-chamber-realms', 10,
     jsonb_build_object(
       'why_now',      '模型能力今年到位，多智能体涌现终于稳定可展。',
       'reach_out',    '做 AI / 社会性的策展人、art-tech 驻地。',
       'hidden_links', '跟 The Persona Commodity 共享"AI 重塑人的价值"。')),
  ('Beloved Charlie', '参与式装置', '过度殷勤的乖顺。', 'intimacy', '#/beloved-charlie', 20, '{}'::jsonb),
  ('Find Hu Di', '行为', '百日自我广播。', 'intimacy', '#/find-hu-di', 30, '{}'::jsonb),
  ('Too on the Nose', '装置', '对自我与身份的防御。', 'intimacy', '#/too-on-the-nose-', 40, '{}'::jsonb),
  ('Make a Friend and Have Hotpot', '参与式', '共食的姿态被搬演。', 'intimacy', '#/make-a-friend-and-have-hotpot', 50, '{}'::jsonb),
  ('On the Back of Silver Dragon', '装置', '技术与阶层等级带来的异化。', 'systems', '#/on-the-back-of-silver-dragon', 60, '{}'::jsonb),
  ('Peace Talk', '装置', '民主程序的失效。', 'systems', '#/peace-talk', 70,
     jsonb_build_object('note', '（示例）盒子里已有 1 条你补的私密备注。')),
  ('The Wheels Never Go Backward', '装置', '技术发展与社会变迁。', 'systems', '#/the-wheels-never-go-backward', 80, '{}'::jsonb),
  ('The Persona Commodity', '写作项目', 'AI 如何重塑普通人的机会与价值。', 'systems', '#/the-persona-commodity', 90, '{}'::jsonb),
  ('The Garden of Digital Delights', '装置', '尺度与空间激起的身体参与。', 'body_space_time', '#/the-garden-of-digital-delights', 100, '{}'::jsonb),
  ('Pi', '装置', '在场与地方。', 'body_space_time', '#/pi', 110, '{}'::jsonb);
