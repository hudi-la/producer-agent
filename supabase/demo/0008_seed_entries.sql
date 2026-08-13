-- ⚠️ 示范内容，不是系统的一部分。整个 demo/ 装的是一位艺术家的公开作品集，
--    fork 下来请换成你自己的 —— 见 demo/README.md。
--
-- 下面这行是护栏（migration 0059）。这个库里要是真人的数据，整支在这里中止，
-- 一行都不会删。种子必须整支跑在一个事务里，护栏才拦得住后面的 truncate。
select producer.demo_guard();

-- Seed: non-work entries for the 战绩信息库 (works themselves seeded in 0002).
-- Hu Di's real CV — statement / bio / teaching & professional experience /
-- education / exhibitions·residency·grants·curatorial (credit) / skills.
-- Mirrors src/data/entriesSeed.js. (Applied to jjgvvtrsnoqnoigukobi via MCP 2026-08-03.)

delete from producer.works where kind in ('statement','job','education','credit','skill');

-- ── 自述 · Bio ──
insert into producer.works (kind, title, body, source, sort, meta, box, tags) values
 ('statement','Artist Statement','我的作品关于被看见、被爱、被理解——把对爱与亲密的痴望，放进社会系统结构的超现实里检视。以装置为主（微缩+日常物、沉浸式、参与式，观众即共同作者），把 AI / 新媒体当材料，也当批评对象。','manual',210, jsonb_build_object('scope','artist'), jsonb_build_object('note','（可在盒子里放不同长度/语气的版本，投递时按机会取用）'), array['statement','intimacy','systems']),
 ('statement','一句话 Bio','现居洛杉矶的跨学科艺术家，理科背景（物理 + 计算机科学）转向艺术，以装置、AI / 新媒体与社会介入为主要方向。','manual',220, jsonb_build_object('scope','bio-short'), '{}'::jsonb, array['bio']);

-- ── 工作 · 职业经历（CV 原文，逐条保留）──
insert into producer.works (kind, title, body, source, sort, meta) values
 ('job','Instructor, media art, game-based storytelling, and AI as a creative tool',
  '· Designed and led an interactive workshop for Korean exchange students, exploring how personal cross-cultural narratives can be translated into small-scale, game-based artworks.
· Developed an experimental curriculum bridging storytelling, game logic, and AI-assisted creative tools (Cursor), enabling non-technical participants to prototype interactive works.
· Facilitated a full creative pipeline—from conceptual framing to playable prototypes—emphasizing accessibility, iteration, and artistic authorship over technical mastery.',
  'manual',300, jsonb_build_object('org','CultureHub','role','Instructor, media art, game-based storytelling, and AI as a creative tool','start','2026.01','end','','location','LA, CA')),
 ('job','Lecturer, Programming for Creative Applications',
  '· Developed and taught an interdisciplinary Creative Coding course, introducing students to generative art, interactive design, and creative programming.
· Integrated p5.js, HTML, Website Design, and GPT-based interactive systems into coursework, helping students explore computational aesthetics and real-time interactive experiences.
· Encouraged project-based learning where students created interactive digital art and experimental media projects.',
  'manual',310, jsonb_build_object('org','Loyola Marymount University (LMU)','role','Lecturer, Programming for Creative Applications','start','2025 春','end','','location','LA, CA')),
 ('job','Visiting Faculty, Coding for Artist - Make a Chatbot',
  '· Designed and taught introductory creative coding courses using Python, guiding students in building AI-driven chatbots and interactive installations.
· Introduced students to natural language processing (NLP) and generative art by integrating GPT-based frameworks into their projects, fostering exploration at the intersection of art and technology.
· Developed project-based curricula emphasizing hands-on experimentation and iterative design, encouraging students to use Python as a tool for real-time interaction and creative expression.
· Mentored students on incorporating computational thinking into artistic practice, bridging the gap between conceptual ideas and technical implementation.',
  'manual',320, jsonb_build_object('org','California Institute of the Arts (CalArts)','role','Visiting Faculty, Coding for Artist - Make a Chatbot','start','2024 冬','end','2025','location','Valencia, CA')),
 ('job','Teaching Assistant',
  '· Co-taught Painting and Undergraduate Critique courses, providing individual critiques and contributing to course discussions.
· Guided students in delivering lectures and critiques as part of a visiting artist simulation, fostering professional practice.
· Supported interdisciplinary experimentation, encouraging the integration of new media and installation art.',
  'manual',330, jsonb_build_object('org','California Institute of the Arts (CalArts)','role','Teaching Assistant','start','2023','end','2024','location','Valencia, CA')),
 ('job','Curator',
  '· Curated and managed exhibitions focusing on social commentary and collective consciousness.
· Developed online and physical engagement strategies to enhance audience participation.',
  'manual',340, jsonb_build_object('org','Beijing Gravity Art Museum','role','Curator','start','2021','end','2022','location','Beijing, China')),
 ('job','Founder & Director of AI Department',
  '· Led the development of AI-focused educational content, producing online courses and interactive learning materials.
· Managed and trained a team of educators, creating AI and data science curricula that trained over 1000 students in industry-leading skills.',
  'manual',350, jsonb_build_object('org','Chaoju Technology (Acquired by Huike Group)','role','Founder & Director of AI Department','start','2018','end','2021','location','Beijing, China')),
 ('job','Data Scientist',
  '· Developed AI algorithms and interactive applications, contributing to intelligent chatbot systems and AI computer vision platforms.
· Collaborated with banks and tech industries to design and implement core conversation models and machine learning pipelines.',
  'manual',360, jsonb_build_object('org','IBM China Development Lab','role','Data Scientist','start','2018','end','2019','location','Beijing, China'));

-- ── 教育 · 背景 ──
insert into producer.works (kind, title, body, source, sort, meta) values
 ('education','MFA · Art Program','','manual',400, jsonb_build_object('school','California Institute of the Arts (CalArts)','year','2022 – 2024','location','Valencia, CA')),
 ('education','M.S. · Computer Science and Technology','','manual',410, jsonb_build_object('school','Zhejiang University','year','2015 – 2018','location','China')),
 ('education','B.S. · Physics','','manual',420, jsonb_build_object('school','Beijing Normal University','year','2011 – 2015','location','China'));

-- ── 展览 · 驻地 · 获奖 · 策展 (credit; meta.type = 个展/群展/驻地/grant/策展) ──
insert into producer.works (kind, title, body, source, sort, meta) values
 ('credit','The Garden of Digital Delights','','manual',510, jsonb_build_object('type','个展','org','the Reef','year','2026','location','LA, CA')),
 ('credit','Peace Talk','','manual',511, jsonb_build_object('type','个展','org','the Reef','year','2025','location','LA, CA')),
 ('credit','Echo Chamber Realms','','manual',512, jsonb_build_object('type','个展','org','CalArts','year','2024','location','Valencia, CA')),
 ('credit','On the Back of Silver Dragon','','manual',513, jsonb_build_object('type','个展','org','CalArts','year','2024','location','Valencia, CA')),
 ('credit','Too on the Nose','','manual',514, jsonb_build_object('type','个展','org','CalArts','year','2023','location','Valencia, CA')),
 ('credit','Three Rooms','','manual',515, jsonb_build_object('type','个展','org','CalArts','year','2023','location','Valencia, CA')),
 ('credit','e/crit-s','','manual',520, jsonb_build_object('type','群展','org','Phase Gallery','year','2026','location','Los Angeles, CA')),
 ('credit','AntiFreize','','manual',521, jsonb_build_object('type','群展','org','the Reef','year','2026','location','LA, CA')),
 ('credit','Skipping the Future','','manual',522, jsonb_build_object('type','群展','org','Art in Room Gallery','year','2025','location','Los Angeles, CA')),
 ('credit','Latency','','manual',523, jsonb_build_object('type','群展','org','Cevera Yoon Gallery','year','2025','location','Los Angeles, CA')),
 ('credit','Working from Home','','manual',524, jsonb_build_object('type','群展','org','the Reef','year','2025','location','Los Angeles, CA')),
 ('credit','LAAF_TeoriaMnogości','','manual',525, jsonb_build_object('type','群展','org','','year','2024','location','Łódź, Poland')),
 ('credit','Nomad III','','manual',526, jsonb_build_object('type','群展','org','Torrance Art Museum','year','2024','location','Torrance, CA')),
 ('credit','The Kitchen Table','','manual',527, jsonb_build_object('type','群展','org','CalArts','year','2024','location','Valencia, CA')),
 ('credit','Casting Coyote Ugly','','manual',528, jsonb_build_object('type','群展','org','CalArts','year','2024','location','Valencia, CA')),
 ('credit','Late to the Party','','manual',529, jsonb_build_object('type','群展','org','CalArts','year','2023','location','Valencia, CA')),
 ('credit','The Desired Magic Weapon','','manual',530, jsonb_build_object('type','群展','org','CalArts','year','2023','location','Valencia, CA')),
 ('credit','Birds and the Curiosity','','manual',531, jsonb_build_object('type','群展','org','Fringe Festival','year','2023','location','Los Angeles, CA')),
 ('credit','Happenings, CalArts 50th Anniversary','','manual',532, jsonb_build_object('type','群展','org','CalArts','year','2023','location','Valencia, CA')),
 ('credit','Me, illusory','','manual',533, jsonb_build_object('type','群展','org','CalArts','year','2023','location','Valencia, CA')),
 ('credit','Abyss','','manual',534, jsonb_build_object('type','群展','org','CalArts','year','2023','location','Valencia, CA')),
 ('credit','Matrilineal Ambivalences','','manual',535, jsonb_build_object('type','群展','org','Home LA','year','2023','location','Los Angeles, CA')),
 ('credit','The Reef Residency','','manual',540, jsonb_build_object('type','驻地','org','the Reef','year','2025','location','LA, CA')),
 ('credit','Foundation for Contemporary Arts Emergency Grant','','manual',545, jsonb_build_object('type','grant','org','Foundation for Contemporary Arts','year','2024','location','')),
 ('credit','Multiple Awards and Grants','含 50th Anniversary Grant、Dean’s Project Award、Student Project Grant。','manual',546, jsonb_build_object('type','grant','org','California Institute of the Arts','year','2022 – 2024','location','')),
 ('credit','Lush Field','Curator & Art Director','manual',560, jsonb_build_object('type','策展','org','','year','2025','location','LA, CA')),
 ('credit','Late to the Party','Curator','manual',561, jsonb_build_object('type','策展','org','CalArts','year','2023.11','location','Valencia, CA')),
 ('credit','2023 CalArts Expo（Producers & Creative Team）','Curator & Creative Director','manual',562, jsonb_build_object('type','策展','org','CalArts','year','2023.05','location','Valencia, CA')),
 ('credit','Reimagining Art Institutions and Community','Seminar co-organizer','manual',563, jsonb_build_object('type','策展','org','Human Resources','year','2023.04','location','Los Angeles, CA')),
 ('credit','Abyss','Curator','manual',564, jsonb_build_object('type','策展','org','CalArts','year','2023.03','location','Valencia, CA'));

-- ── 技能 ──
insert into producer.works (kind, title, body, source, sort, meta) values
 ('skill','Programming','Python、JavaScript (p5.js)、Arduino (C/C++)','manual',700,'{}'::jsonb),
 ('skill','AI & Machine Learning','NLP 与计算机视觉（算法理解与实现）；大语言模型（GPT 系）；AI 辅助创作工作流（Cursor、Manus、Keplore）','manual',710,'{}'::jsonb),
 ('skill','Physical Computing','Arduino、传感器','manual',720,'{}'::jsonb),
 ('skill','Software','Adobe Creative Suite','manual',730,'{}'::jsonb);
