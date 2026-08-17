-- 自述 · Bio 第三条：Research Statement（读博方向）。
--
-- 为什么单独一支、而且**没有** demo_guard()：
--   0008 那支要 delete 掉整批 statement/job/education/credit/skill 再重灌，
--   护栏是拦那个 delete 的。这一支只动 title = 'Research Statement' 这一行，
--   加进去、或者原地换掉，别的一条都不碰 —— 对着真人的库跑是安全的，
--   所以不需要护栏，也不该走 0008（走 0008 就要连带重灌整份履历）。
--
-- 为什么放档案而不是某张机会线上：
--   brain 每次起工都把**整个档案的 entries** 拼进 prompt
--   （brain/server.js 的 entriesBlock），一条机会线、一个联系人都一样。
--   所以研究方向放在这儿 = 以后开多少条套词线，Fairwind 都自动知道，
--   一次手动 attach 都不用。附件那条路只在 prompt 里露一个文件名，更弱。
--
-- 这一条是**给 Fairwind 看的**：紧凑、事实密度高，因为它进每一次 prompt。
-- 给老师看的那份（英文、成品、可当附件）是另一份东西，不在这里。
-- 完整的方向底稿在 docs/phd/2026-08-14-研究方向底稿.md，那份太长，不进 prompt。

delete from producer.works where kind = 'statement' and title = 'Research Statement';

insert into producer.works (kind, title, body, source, sort, meta, box, tags) values
 ('statement','Research Statement',
  -- 界面上条目正文是纯文本渲染（src/components/Library.jsx 的 w-d），
  -- 所以这里不用 markdown —— 写 ** 会原样显示出来。强调一律用「」。
  '在申请 PhD（美国西岸为主）。研究问题：人对一个非人之物的投射是怎么被制造出来的——以及当这些物之间开始产生「关系模式」时，这件事发生了什么变化。向人投射几乎是自动的（对方激烈反对也照样发生），向物不是，它要被一级一级地制造出来；我的装置就是这个制造过程的实验。已有材料：Echo Chamber Realms——几个内置不同心理动力的 LLM 代理，在没有显式编程的情况下自发涌现出说教型鼓励、竞争等可辨认的关系模式；以及现场证据——一群被职业要求压抑回避的演员，集体对那个回避型代理产生了保护性柔情。我的路径本身是这个问题的闭环：浙江大学计算机背景、IBM data scientist 做 AI/NLP 算法与对话系统（让机器像人一样说话），四年前转入艺术，现在做的是它的反面——人在什么条件下开始把一个非人的东西当成人。起草读博相关的信时：先立艺术命题，再让计算机背景作为「能力」出现，不要写成身份——顺序反了会被读成「技术人做艺术」。',
  'manual', 230,
  jsonb_build_object('scope','research'),
  jsonb_build_object('note','（完整底稿见 docs/phd/2026-08-14-研究方向底稿.md；给老师的英文 research statement 等第一个套词对象定了再做）'),
  array['research','phd','projection','multi-agent']);
