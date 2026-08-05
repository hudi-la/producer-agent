-- Sample 机会线 mirroring the pipeline mockup, + Eyebeam's full 往来历史 (memory).
truncate producer.pursuit_messages;
truncate producer.pursuits cascade;

insert into producer.pursuits (title, org, location, funding, deadline, match_stars, why, source, eligible, stage, work_id) values
  ('Prix Ars Electronica', 'Ars Electronica', '林茨', '奖金', '约 6 周', 3,
     '多智能体 AI 装置正中他们对 AI/新媒体的偏好；是奖不是驻地，国际开放，不卡签证。', 'scout', true, 'proposed', null),
  ('某画廊群展', null, null, null, null, 2, null, 'manual', true, 'proposed', null),
  ('Rijksakademie 驻地', 'Rijksakademie', '阿姆斯特丹', '生活费+工作室', '约 8 周', 3,
     '顶级研究型驻地，国际、带资助，重实验与方法——跟你物理+计算的路子对味。', 'scout', true, 'brief', null),
  ('transmediale 征件', 'transmediale', '柏林', '含制作费', '约 4 周', 3,
     '"技术作为批评对象" + 社会介入，跟你几乎同频；国际。', 'scout', true, 'pick_work', null),
  ('Eyebeam 驻地 2027', 'Eyebeam', '纽约', 'stipend + 工作空间', '约 8 周', 3,
     '重过程与公共性，偏爱把技术当批评对象、有社会性的创作者——几乎照着你写的。', 'scout', true, 'writing',
     (select id from producer.works where title = 'Echo Chamber Realms')),
  ('NEW INC', 'New Museum', '纽约', null, null, 2, null, 'manual', true, 'submitted',
     (select id from producer.works where title = 'The Garden of Digital Delights')),
  ('某 AI 艺术 grant', null, null, null, '第 5 天', 2, null, 'scout', true, 'waiting',
     (select id from producer.works where title = 'The Persona Commodity')),
  ('某 group show', null, null, null, null, 2, null, 'manual', true, 'won',
     (select id from producer.works where title = 'Peace Talk')),
  ('某影像节', null, null, null, null, 2, null, 'manual', true, 'shelved',
     (select id from producer.works where title = 'The Wheels Never Go Backward')),
  ('Creative Capital', 'Creative Capital', '美国', '资助', null, 3,
     '很对味，但限美国公民/绿卡——你 O-1 现在申不了。放到待身份变化。', 'scout', false, 'proposed', null);

-- Eyebeam 的往来历史（记忆）
insert into producer.pursuit_messages (pursuit_id, role, kind, content)
select p.id, v.role, v.kind, v.content
from producer.pursuits p,
  (values
    ('producer','brief','Eyebeam 是纽约老牌的艺术与技术驻地，不要成品、要过程与公共性——正合你"观众即共同作者"的做法。评审偏爱把技术当批评对象、带社会性的创作者。提供 stipend + 工作空间 + 公共项目支持；国际可申（O-1 没问题）；交项目陈述 · 作品集 · 驻地设想；截止约 8 周。'),
    ('producer','message','主打 Echo Chamber Realms——多智能体 AI、参与式，正中他们的偏好。他们也吃"AI 如何重塑人的价值"这类议题，而你 The Persona Commodity 正是讲这个。要不要让陈述带一条 Persona 的线，把批判份量压上去？'),
    ('artist','decision','主打 Echo Chamber Realms。Persona 那条线保留，别丢。'),
    ('producer','message','记下了 ✎ 主打 Echo Chamber Realms，保留 Persona Commodity 线。往下我按这个写。'),
    ('producer','draft','My installations begin from a physicist''s habit: to take an invisible structure and make it something you can stand inside. In Echo Chamber Realms, I let multi-agent AI systems talk until patterns of attachment, competition, and care surface on their own — then I stage the encounter so a visitor doesn''t just watch the pattern, but meets it in themselves. At Eyebeam I want to push this from a scene one witnesses toward one the visitor co-authors…')
  ) as v(role, kind, content)
where p.title = 'Eyebeam 驻地 2027';
