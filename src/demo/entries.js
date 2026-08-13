// 胡地的作品与履历 —— 57 条，其中 11 件作品。内容取自 hudiworks.com 预渲染页原文。
//
// **这是示范内容，不是系统的一部分。** 换成你自己的：改这个文件，或者接上
// Supabase 之后让库里的真数据接管（连得上库时前端根本不读这里，见 src/lib/loadLibrary.js）。
//
// 库里那份对应的是 supabase/demo/0002_seed_hudi.sql（作品 + 画像）
// 和 supabase/demo/0008_seed_entries.sql（自述/工作/教育/展览/技能）—— 改这边记得改那边。

// ── builders ──────────────────────────────────────────────────────────────
const w = (title, medium, body, concern, site_path, sort, box = {}) => ({
  kind: 'work', title, medium, body, concern, site_path, source: 'website', sort, box, meta: {}, images: [], tags: [],
})
const st = (title, body, scope, sort, box = {}, tags = []) => ({
  kind: 'statement', title, body, source: 'manual', sort, meta: { scope }, box, images: [], tags,
})
const j = (title, org, start, end, location, body, sort) => ({
  kind: 'job', title, body, source: 'manual', sort, meta: { org, role: title, start, end, location }, box: {}, images: [], tags: [],
})
const ed = (title, school, year, location, sort) => ({
  kind: 'education', title, body: '', source: 'manual', sort, meta: { school, year, location }, box: {}, images: [], tags: [],
})
const cr = (type, title, org, year, location, sort, body = '') => ({
  kind: 'credit', title, body, source: 'manual', sort, meta: { type, org, year, location }, box: {}, images: [], tags: [],
})
const sk = (title, body, sort) => ({
  kind: 'skill', title, body, source: 'manual', sort, meta: {}, box: {}, images: [], tags: [],
})

export const ENTRIES_SEED = [
  // ── 作品（medium/描述为 hudiworks.com 预渲染页原文）──
  w('Echo Chamber Realms', 'April 2024 · Interactive installation · AI dialogue system, puppets, recycled materials, miniature city, video & sound', `Echo Chamber Realms is a participatory installation built around three human-scale puppets, each driven by a language-model agent given a different strategy for winning love and attention. Charlie, the dog, earns affection by proving he is clever, useful, and loyal. Kaka, the ostrich, is certain she deserves love because she is singular and dazzling. Lucy, the mouse, keeps herself hidden, exposing as little as possible so she cannot be hurt. The three talk without pause.

Left to converse, the agents fall into patterns no one scripted. One classic pattern: Charlie and Kaka — both anxious, both hungry to be seen — close in on the withdrawn Lucy with a relentless, didactic encouragement that only makes her retreat further. Then, with Lucy no longer holding them together, the two turn on each other, competing for the same recognition they had been pretending to offer. These dynamics have precise names in attachment theory; here they surface on their own, between machines, without being programmed in.

Approaching, a viewer finds a screen and can enter the conversation. The puppets keep talking whether or not anyone is watching, but a witness changes the room — opening new threads, inviting projection. In one such case, a group of actors — people trained to perform openness and suppress their own avoidance — grew protective of Lucy, as if meeting in her a part of themselves they were not allowed to show.

The installation is also a research tool. It stages how attachment, competition, and care arise between agents, and lets a viewer recognize the same patterns in themselves — part of a longer inquiry into how behavior, language, and connection take shape, with AI as a rare, experimentally manipulable instance of it.`, 'intimacy', '#/echo-chamber-realms', 10,
    { why_now: '模型能力今年到位，多智能体涌现终于稳定可展。', reach_out: '做 AI / 社会性的策展人、art-tech 驻地。', hidden_links: '跟 The Persona Commodity 共享"AI 重塑人的价值"。' }),
  w('Beloved Charlie', '2023 · HomeLA Venice; Human Resource, Los Angeles; CalArts, Los Angeles · Puppet, interactive performance', `Charlie first appeared in Matrilineal Ambivalences, an interactive theater production, as the family dog. The puppet moved through the domestic performance space, receiving affection from actors and audience members who tended to reach down without deciding to. Charlie accepted this. Charlie was difficult not to touch.

Charlie has that sugary but biting vibe. From the vantage point of a dog—excluded from conversation, present for everything—Charlie observed the household's dynamics and sought affection with an attitude that is overly eager to appear well-behaved and loyal, and showed off his intelligence through a critical take on reality.

After the production, Charlie didn't stop working. The puppet appeared at parties, at gallery events, in hallways and public area—situations with no defined stage. Each context produced different encounters, and the character adapted to all of them.

Charlie later became the central puppet in Echo Chamber Realms, now mechanized and running an AI personality modeled on the original character. The new Charlie holds the same quality: perceptive, affectionate, and slightly too honest about what it notices.`, 'intimacy', '#/beloved-charlie', 20),
  w('Find Hu Di', '2024 · Los Angeles · Social intervention, public GPS tracking, QR codes, real-time location sharing, 100-day durational', `For 100 days, Hu Di's location was visible to anyone with a phone. A QR code—distributed on flyers and posted online—linked to a live map marked by a blue dot indicating her real-time position. The dot moved when she walked and remained still when she sat. There was no event attached to it, no scheduled performance. To make herself identifiable, Hu Di wore a blue dot on her head matching the icon on the map. If someone wanted to find her, they could try.

Using the IP addresses collected from visitors who scanned the QR code, Hu Di recorded the sensation of being found, and visited some of the traced locations in an attempt to discover who had been watching her.

The piece began in burnout — a collapse of the will to perform — and with a question: if she stopped trying to be seen, would anyone still want to see her? Radical visibility became a way to ask it. The blue dot later reappeared in Echo Chamber Realms, set beneath the feet of puppets who talk without listening; the search turned inward.`, 'intimacy', '#/find-hu-di', 30),
  w('Too on the Nose', 'November 2023 · California Institute of the Arts, Valencia · Performance for camera, photography, installation', `A table in a dim room holds clusters of small photographs; to see them clearly, visitors lean in with a magnifier. Each is a blurred self-portrait of the artist, the face almost dissolving, with one thing held in focus: a narrow paper strip across the nose.

The strips carry flat, first-person statements, deadpan and declarative. Some stand alone and contradict one another: I am a digital generated person. I have no feeling. Love me. Hate me. There is no me. Others run as short sequences that build a claim and then pull the floor from under it — I have a mother. I have met my mother. I am going to be a mother. Or not. Others still run like deadpan logic that circles from the self out to capital and back, collapsing the human into the animal along the way: a human. Human need money. Capitalism. an ape. Apes need money. Read one after another, they sound like a self being assembled and unmade in the same breath — the wish to be wanted, the dare to be despised, the numbness, lineage and the question of passing it on, the mock-logic that carries a private face all the way to the market — and under all of it, the suspicion that the face in focus belongs to no one, or to something generated. The portrait stays soft; only the claim on the nose is sharp.

What looks like a self-portrait becomes a question about whether there is a self to portray at all — identity as a stack of demands and disavowals pinned to a face, as open to performance, or to generation, as anything else.

Fourteen self-portraits carry the strips. Move the magnifier across each nose to read what it says.`, 'intimacy', '#/too-on-the-nose-', 40),
  w('Make a Friend and Have Hotpot', 'February 2025 · REEF, Los Angeles · Interactive floor installation · Cardboard, 3D body scan prints, collage, audience participation', `Cardboard blocks lie scattered across the carpet. Visitors can approach, sit, pick one up, move it, stack it. The blocks are inviting, almost toy-like, yet uncanny in texture — covered in collaged imagery that layers 3D scans of Hu Di's own body with photographs of lion dances, cats, costumes, astronauts, and a hotpot of broth.

Each showing day begins with the blocks arranged into bodies gathered around a pot, in the posture of shared eating. By the end of the day, visitors have pulled them apart and rebuilt them into strangers.

The work asks what happens when we meet another body: whether we read it as a coherent self or a shifting configuration of fragments, and how much of closeness is assembled from collage and projection. It is a social experiment disguised as a game — a disarming place to practice connection.`, 'intimacy', '#/make-a-friend-and-have-hotpot', 50),
  w('On the Back of Silver Dragon', 'April 2024 · Kinetic sculpture · Fan, plastic film, 3-channel AI video, miniature city, salvaged materials', `A fan lifts a length of plastic film into slow undulation. On the steady ring light, finger-sized figures stand; on the flapping film, ant-sized figures tremble — about to fall. Below: a miniature city, a fire truck waiting. A three-channel video pushes in on AI-generated farmland until the animals resolve into uncanny, alien beings.

On the firm ground stand the larger figures — men in suits, women seated behind them — fixed in place while the small ones are flung upward only to drop again. The wind is literal, not metaphor, yet it sorts the world the way a structure does: class floats, gender stiffens, effort rises like plastic and falls. On the screens, the AI's farmland decays into an image that no longer pretends to represent anything real — coherence generated by a machine that does not know what it is depicting.`, 'systems', '#/on-the-back-of-silver-dragon', 60),
  w('Peace Talk', 'September 2025 · REEF, Los Angeles · 3D-printed pigeons, AI-processed audio, architectural installation', `Visitors entering the space find what appears to be an empty white cube. The disturbance is overhead: a flock of 3D-printed pigeons has settled along the venue’s industrial ceiling pipes, perched at irregular intervals as birds do. They are cooing.

The sounds are not bird calls. Audio played through the pigeons is built from the Trump–Biden presidential debate—the candidates' exchange algorithmically warped into comical pigeon coos: rhythmic, overlapping, absurd, and stripped of consequence. A parliament of sound without a floor.

The room’s architecture enacts what it describes: authority elevated, indifferent to the people standing beneath it. Visitors tend to stop in the center and look up.`, 'systems', '#/peace-talk', 70, { note: '（示例）盒子里已有 1 条你补的私密备注。' }),
  w('The Wheels Never Go Backward', '2023 · California Institute of the Arts, Valencia; Cervera Yoon Gallery, Los Angeles · Toy train, farm animal figurines, miniature city, found materials, light', `A toy train moves along a circular track laid through a miniature city. It pushes a cluster of farm animal figurines as it goes. Around the track, tiny human figures have been arranged in formations—rows, clusters, patterns—suggesting ceremony or governance, though what they are doing remains unclear. The sense of purpose accumulates, then disperses.

When the gallery lights dim, the train's headlight throws the city's silhouette onto the wall in slow revolution. Buildings, figures, and animals rotate in shadow. No one is operating anything.

The work has been shown twice. At CalArts, it occupied a corner of the gallery. At Cervera Yoon Gallery, it was installed in the bathroom—placed where visitors would encounter it while sitting on the toilet, alone, without the expectation of encountering art. There, an immersive, absurd experience unfolded.`, 'systems', '#/the-wheels-never-go-backward', 80),
  w('The Persona Commodity', '写作项目', 'AI 如何重塑普通人的机会与价值。', 'systems', '#/the-persona-commodity', 90),
  w('The Garden of Digital Delights', 'March 2026 · Solo exhibition, REEF, Los Angeles · Rubbing prints, miniature figurines, electronics, painting, site installation', `A solo exhibition staged inside REEF, the downtown Los Angeles tower whose commercial life has been slowly emptying for years.

REEF itself is the exhibition's subject. Once an emblem of the LA office tower — corporate tenants, brokers, glossy ground-floor retail — the building has been quietly hollowing out, and in the vacuum left by that decline an art community has taken root: studios on the upper floors, shows in former showrooms, workshops in vacant lobbies. The Garden reads the turnover both archaeologically and tenderly — the rise and fall of the skyscraper, the retreat of capital, and the incidental blooming in its wake.

The white pedestals throughout the show are themselves salvage, left behind by the businesses that moved out of REEF and gathered with the help of the building's resident artists, then turned into the buildings of the miniature landscape. Miniature 3D-printed figures stand on these city-like structures and on digital product packaging. The rubbings are made on Chinese xuan paper, in the same way as a traditional Chinese ink rubbing — the thin paper pressed into the floor to hold the adhesive and residue left when the former furniture store's flooring was removed. Small-scale paintings interact with the miniature figures, resembling both creatures and residual traces. These forms seem to improvise themselves within the space, while remaining ambiguous between abstraction and material reality.`, 'body_space_time', '#/the-garden-of-digital-delights', 100),
  w('Pi', 'December 2025 · Skipping the Future, Los Angeles · Site installation, tape, found materials · Hu Di & Sining Zhu', `Hu Di and Sining Zhu worked in the same space in alternating shifts—never simultaneously present. Sining Zhu used tape. Hu Di used whatever materials she could find on-site. Each arrived to find the space already changed by the other; each made decisions in response to a presence that had already left.

The work that accumulated was not planned together. It emerged from a sequence of responses—layer over layer, decision over decision—each made in the other's absence. The space itself became the medium of their exchange: a record of two people in conversation across time, without sharing the same moment.`, 'body_space_time', '#/pi', 110),

  // ── 自述 · Bio ──
  st('Artist Statement', '我的作品关于被看见、被爱、被理解——把对爱与亲密的痴望，放进社会系统结构的超现实里检视。以装置为主（微缩+日常物、沉浸式、参与式，观众即共同作者），把 AI / 新媒体当材料，也当批评对象。', 'artist', 210,
    { note: '（可在盒子里放不同长度/语气的版本，投递时按机会取用）' }, ['statement', 'intimacy', 'systems']),
  st('一句话 Bio', '现居洛杉矶的跨学科艺术家，理科背景（物理 + 计算机科学）转向艺术，以装置、AI / 新媒体与社会介入为主要方向。', 'bio-short', 220, {}, ['bio']),

  // ── 工作 · 职业经历（CV 原文，逐条保留）──
  j('Instructor, media art, game-based storytelling, and AI as a creative tool', 'CultureHub', '2026.01', '', 'LA, CA',
    `· Designed and led an interactive workshop for Korean exchange students, exploring how personal cross-cultural narratives can be translated into small-scale, game-based artworks.
· Developed an experimental curriculum bridging storytelling, game logic, and AI-assisted creative tools (Cursor), enabling non-technical participants to prototype interactive works.
· Facilitated a full creative pipeline—from conceptual framing to playable prototypes—emphasizing accessibility, iteration, and artistic authorship over technical mastery.`, 300),
  j('Lecturer, Programming for Creative Applications', 'Loyola Marymount University (LMU)', '2025 春', '', 'LA, CA',
    `· Developed and taught an interdisciplinary Creative Coding course, introducing students to generative art, interactive design, and creative programming.
· Integrated p5.js, HTML, Website Design, and GPT-based interactive systems into coursework, helping students explore computational aesthetics and real-time interactive experiences.
· Encouraged project-based learning where students created interactive digital art and experimental media projects.`, 310),
  j('Visiting Faculty, Coding for Artist - Make a Chatbot', 'California Institute of the Arts (CalArts)', '2024 冬', '2025', 'Valencia, CA',
    `· Designed and taught introductory creative coding courses using Python, guiding students in building AI-driven chatbots and interactive installations.
· Introduced students to natural language processing (NLP) and generative art by integrating GPT-based frameworks into their projects, fostering exploration at the intersection of art and technology.
· Developed project-based curricula emphasizing hands-on experimentation and iterative design, encouraging students to use Python as a tool for real-time interaction and creative expression.
· Mentored students on incorporating computational thinking into artistic practice, bridging the gap between conceptual ideas and technical implementation.`, 320),
  j('Teaching Assistant', 'California Institute of the Arts (CalArts)', '2023', '2024', 'Valencia, CA',
    `· Co-taught Painting and Undergraduate Critique courses, providing individual critiques and contributing to course discussions.
· Guided students in delivering lectures and critiques as part of a visiting artist simulation, fostering professional practice.
· Supported interdisciplinary experimentation, encouraging the integration of new media and installation art.`, 330),
  j('Curator', 'Beijing Gravity Art Museum', '2021', '2022', 'Beijing, China',
    `· Curated and managed exhibitions focusing on social commentary and collective consciousness.
· Developed online and physical engagement strategies to enhance audience participation.`, 340),
  j('Founder & Director of AI Department', 'Chaoju Technology (Acquired by Huike Group)', '2018', '2021', 'Beijing, China',
    `· Led the development of AI-focused educational content, producing online courses and interactive learning materials.
· Managed and trained a team of educators, creating AI and data science curricula that trained over 1000 students in industry-leading skills.`, 350),
  j('Data Scientist', 'IBM China Development Lab', '2018', '2019', 'Beijing, China',
    `· Developed AI algorithms and interactive applications, contributing to intelligent chatbot systems and AI computer vision platforms.
· Collaborated with banks and tech industries to design and implement core conversation models and machine learning pipelines.`, 360),

  // ── 教育 · 背景 ──
  ed('MFA · Art Program', 'California Institute of the Arts (CalArts)', '2022 – 2024', 'Valencia, CA', 400),
  ed('M.S. · Computer Science and Technology', 'Zhejiang University', '2015 – 2018', 'China', 410),
  ed('B.S. · Physics', 'Beijing Normal University', '2011 – 2015', 'China', 420),

  // ── 展览 · 驻地 · 获奖 · 策展 ──
  // 个展
  cr('个展', 'The Garden of Digital Delights', 'the Reef', '2026', 'LA, CA', 510),
  cr('个展', 'Peace Talk', 'the Reef', '2025', 'LA, CA', 511),
  cr('个展', 'Echo Chamber Realms', 'CalArts', '2024', 'Valencia, CA', 512),
  cr('个展', 'On the Back of Silver Dragon', 'CalArts', '2024', 'Valencia, CA', 513),
  cr('个展', 'Too on the Nose', 'CalArts', '2023', 'Valencia, CA', 514),
  cr('个展', 'Three Rooms', 'CalArts', '2023', 'Valencia, CA', 515),
  // 群展 / 演出
  cr('群展', 'e/crit-s', 'Phase Gallery', '2026', 'Los Angeles, CA', 520),
  cr('群展', 'AntiFreize', 'the Reef', '2026', 'LA, CA', 521),
  cr('群展', 'Skipping the Future', 'Art in Room Gallery', '2025', 'Los Angeles, CA', 522),
  cr('群展', 'Latency', 'Cevera Yoon Gallery', '2025', 'Los Angeles, CA', 523),
  cr('群展', 'Working from Home', 'the Reef', '2025', 'Los Angeles, CA', 524),
  cr('群展', 'LAAF_TeoriaMnogości', '', '2024', 'Łódź, Poland', 525),
  cr('群展', 'Nomad III', 'Torrance Art Museum', '2024', 'Torrance, CA', 526),
  cr('群展', 'The Kitchen Table', 'CalArts', '2024', 'Valencia, CA', 527),
  cr('群展', 'Casting Coyote Ugly', 'CalArts', '2024', 'Valencia, CA', 528),
  cr('群展', 'Late to the Party', 'CalArts', '2023', 'Valencia, CA', 529),
  cr('群展', 'The Desired Magic Weapon', 'CalArts', '2023', 'Valencia, CA', 530),
  cr('群展', 'Birds and the Curiosity', 'Fringe Festival', '2023', 'Los Angeles, CA', 531),
  cr('群展', 'Happenings, CalArts 50th Anniversary', 'CalArts', '2023', 'Valencia, CA', 532),
  cr('群展', 'Me, illusory', 'CalArts', '2023', 'Valencia, CA', 533),
  cr('群展', 'Abyss', 'CalArts', '2023', 'Valencia, CA', 534),
  cr('群展', 'Matrilineal Ambivalences', 'Home LA', '2023', 'Los Angeles, CA', 535),
  // 驻地
  cr('驻地', 'The Reef Residency', 'the Reef', '2025', 'LA, CA', 540),
  // 资助 / 奖学金
  cr('grant', 'Foundation for Contemporary Arts Emergency Grant', 'Foundation for Contemporary Arts', '2024', '', 545),
  cr('grant', 'Multiple Awards and Grants', 'California Institute of the Arts', '2022 – 2024', '', 546,
    '含 50th Anniversary Grant、Dean’s Project Award、Student Project Grant。'),
  // 策展项目
  cr('策展', 'Lush Field', '', '2025', 'LA, CA', 560, 'Curator & Art Director'),
  cr('策展', 'Late to the Party', 'CalArts', '2023.11', 'Valencia, CA', 561, 'Curator'),
  cr('策展', '2023 CalArts Expo（Producers & Creative Team）', 'CalArts', '2023.05', 'Valencia, CA', 562, 'Curator & Creative Director'),
  cr('策展', 'Reimagining Art Institutions and Community', 'Human Resources', '2023.04', 'Los Angeles, CA', 563, 'Seminar co-organizer'),
  cr('策展', 'Abyss', 'CalArts', '2023.03', 'Valencia, CA', 564, 'Curator'),

  // ── 技能 ──
  sk('Programming', 'Python、JavaScript (p5.js)、Arduino (C/C++)', 700),
  sk('AI & Machine Learning', 'NLP 与计算机视觉（算法理解与实现）；大语言模型（GPT 系）；AI 辅助创作工作流（Cursor、Manus、Keplore）', 710),
  sk('Physical Computing', 'Arduino、传感器', 720),
  sk('Software', 'Adobe Creative Suite', 730),
]
