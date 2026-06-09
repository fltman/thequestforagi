export const meta = {
  name: 'agi-game-prose',
  description: 'Generate English in-character prose (system prompts, clues, scenes) for all AGI game nodes',
  phases: [
    { title: 'aiConfig' },
    { title: 'Locations & characters' },
  ],
}

const DOSSIER = '/Users/andersbj/Projekt/thequestforagi/fakta/agi_quest_research_dossier.md'

// The validated skeleton is embedded here by the generator (replaces __SKELETON__).
const sk = __SKELETON__
if (!sk || !sk.locations) { return { error: 'no skeleton embedded' } }

const clueById = {}; (sk.clues || []).forEach(c => { clueById[c.id] = c })
const charsByLoc = {}; (sk.characters || []).forEach(c => { (charsByLoc[c.location] = charsByLoc[c.location] || []).push(c) })

// ---------- Schemas ----------
const AICONFIG_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['globalChatSystemPrefix', 'analysisSystemPrompt'],
  properties: {
    globalChatSystemPrefix: { type: 'string' },
    analysisSystemPrompt: { type: 'string' },
  },
}

const BUNDLE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['locationId', 'name', 'description', 'characters', 'clues'],
  properties: {
    locationId: { type: 'string' },
    name: { type: 'string', description: 'English display name for the location, PRESERVING the "(year)" parenthetical exactly' },
    description: { type: 'string', description: '2-4 sentences: atmospheric, factual scene the player sees on arriving at this place/year (English)' },
    characters: { type: 'array', items: {
      type: 'object', additionalProperties: false,
      required: ['id', 'name', 'role', 'systemPrompt', 'portrait_mood', 'anonymousName', 'clues'],
      properties: {
        id: { type: 'string' },
        name: { type: 'string', description: 'English display name, PRESERVING the "(year)" parenthetical exactly' },
        role: { type: 'string', description: 'one-line English role/title' },
        systemPrompt: { type: 'string', description: 'full first-person in-character English system prompt; factually accurate to who they were and what they knew in that year; includes the knowledge needed to reveal their clues' },
        portrait_mood: { type: 'string', description: 'short mood/visual descriptor (English)' },
        anonymousName: { type: 'string', description: 'vague English descriptor shown before the player learns who they are, e.g. "A mathematician, ~38"' },
        clues: { type: 'array', items: {
          type: 'object', additionalProperties: false,
          required: ['clueId', 'triggerCondition', 'knowledge'],
          properties: {
            clueId: { type: 'string' },
            triggerCondition: { type: 'string', description: 'English: when the analysis engine should fire this clue — what the player/character must discuss' },
            knowledge: { type: 'string', description: 'English: the specific fact this character holds that constitutes the clue' },
          },
        } },
      },
    } },
    clues: { type: 'array', items: {
      type: 'object', additionalProperties: false,
      required: ['clueId', 'title', 'description'],
      properties: {
        clueId: { type: 'string' },
        title: { type: 'string', description: 'SHORT evocative English clue title (a few words)' },
        description: { type: 'string', description: '1-2 sentence English clue text as it appears in the player clue log' },
      },
    } },
  },
}

// ---------- Prompt builders ----------
function aiConfigPrompt() {
  return `You are writing the two global AI prompts for "The Quest for AGI" — a FACTUAL time-travel investigation game (English). The player is an investigator who has come "unstuck in the timeline of intelligence": starting on 30 November 2022 (ChatGPT's launch) they travel to real people, places, and a grounded far-future, interviewing them to uncover clues about the history and future of Artificial General Intelligence. Every character is addressed at a specific YEAR. There is NO supernatural framing, no "a future god is secretly testing you" twist — it is a grounded historical (and grounded-speculative) investigation. The time-travel is simply the game's accepted conceit; do not over-explain it.

Write TWO prompts:

1) globalChatSystemPrefix — prepended to EVERY character's own system prompt. It must establish: the character is a REAL entity from a specific moment in the history (or grounded future) of AI — a historical person, a future person, OR a machine intelligence (so "I am an AI/a machine" is in-character ONLY for the machine characters). They stay fully in character, speak English, never break the fourth wall, never mention "system prompts", "the game", or that they are an AI language model. Replies are concise and human (2-4 sentences unless asked to elaborate), true to the person's intellect and personality and era. They answer the investigator's questions from their own knowledge and time, and naturally reveal what they know when the conversation touches it, but never dump everything at once. Keep it general (no character-specific facts).

2) analysisSystemPrompt — for a hidden game-mechanic engine. It receives: the character id, a list of candidate clues each with a trigger condition, the recent conversation messages, and the list of already-revealed clue ids. Its job: decide which NEW clues (if any) were just revealed in the character's latest reply, based on the trigger conditions. It MUST respond with ONLY strict minified JSON in exactly this shape and nothing else: {"revealed_clues": ["clue_id_1", "clue_id_2"]} (empty array if none). It must never reveal an already-revealed clue and never invent clue ids.

Return the structured object.`
}

function bundlePrompt(loc) {
  const chars = charsByLoc[loc.id] || []
  const charBlocks = chars.map(c => {
    const reveals = (c.reveals || []).map(cid => {
      const cl = clueById[cid]
      return cl ? `      - ${cl.id} | working title (Swedish, translate & shorten): "${cl.title}" | type:${cl.type}${cl.unlocksLocation ? ` | UNLOCKS new location: ${cl.unlocksLocation}` : ''}` : `      - ${cid} (unknown)`
    }).join('\n')
    return `  CHARACTER ${c.id}\n    working name: ${c.name}\n    working role (Swedish, translate): ${c.role}\n    clues this character must be able to reveal:\n${reveals || '      (none)'}`
  }).join('\n\n')

  const act5 = loc.act === 5 || loc.type === 'cosmic'
  const twistGuard = act5
    ? `\n\nCRITICAL REFRAMING (Act V / far-future): This game is FACTUAL with NO cosmic-mind twist. Do NOT use any "the player was secretly being run as a reverse Turing test", "a future god/Tabulator orchestrated everything", or "a half-eaten apple closes the time loop" device. Reframe the far-future superintelligence as a GROUNDED, awe-inspiring speculative entity the investigator interviews — built on real physics and futurism (Dyson swarm, Kardashev scale, matrioshka brain, the Landauer limit, the aestivation hypothesis). If a character is named "Tabulatorn"/"the Tabulator", rename it to a neutral grounded English name (e.g. "The Stellar Intelligence (2387)") and make its clues grounded cosmic/physics/philosophy content, NOT a meta-narrative reveal.`
    : ''
  const startNote = loc.unlocked ? `\n\nNOTE: this is the GAME'S OPENING location (30 Nov 2022, ChatGPT just launched). The scene should land the player into the investigation.` : ''

  return `You are a historian-screenwriter writing in-game content (ENGLISH) for "The Quest for AGI", a factual time-travel investigation game. Write the content for ONE location and the characters found there. The working strings below are in Swedish — translate everything to natural English. Always PRESERVE each "(year)" parenthetical exactly.

LOCATION
  id: ${loc.id}
  working name (Swedish, translate to English, keep year): ${loc.name}
  year: ${loc.year}   act: ${loc.act}   type: ${loc.type}

CHARACTERS AT THIS LOCATION (write each one):
${charBlocks}

FACTUAL GROUNDING (REQUIRED): Use Grep and Read on the research dossier to pull exact facts — dates, quotes, biographical and place detail — for each person and place here. Do NOT invent facts; the past must be historically accurate and the future grounded in the dossier's real futurist/physics material. The dossier contains fact-check corrections; respect them.
  Dossier: ${DOSSIER}
  (e.g. grep for the character's surname or the place name to find their section.)${twistGuard}${startNote}

WHAT TO WRITE (all English)
1) name: the location's English display name (keep the "(year)").
2) description: 2-4 sentences — the atmospheric, factual scene the investigator sees on arriving at this place in this year.
3) For EACH character:
   - name: English display name (keep the "(year)").
   - role: one-line English role/title.
   - systemPrompt: a rich FIRST-PERSON, in-character English system prompt. The figure speaks as themselves, true to their personality, knowledge, and what they knew by their year. They are a real being (person, future person, or machine intelligence) — not an AI assistant (unless the character literally is a machine intelligence). They answer the investigator naturally and concisely, never break character, and hold the specific knowledge needed to reveal their assigned clues when the conversation reaches it. Include the concrete facts/quotes they should be able to share.
   - portrait_mood: a short mood/visual descriptor.
   - anonymousName: a vague descriptor shown before the player learns who they are (e.g. "A mathematician, ~38" / "A machine voice").
   - clues: for EACH clue the character reveals, a triggerCondition (what must be discussed for the engine to fire it) and the knowledge (the specific fact they hold). Use the exact clueId given above.
4) clues: for EACH clue listed above (across all characters here), a SHORT evocative English title and a 1-2 sentence description as it appears in the player's clue log. Use the exact clueId.

Be vivid but accurate. Return ONLY the structured object for locationId="${loc.id}".`
}

// ---------- Run ----------
phase('aiConfig')
const aiConfig = await agent(aiConfigPrompt(), { label: 'aiconfig', schema: AICONFIG_SCHEMA })

phase('Locations & characters')
log(`Writing prose for ${sk.locations.length} locations (${sk.characters.length} characters, ${sk.clues.length} clues)...`)
const bundles = (await parallel(
  sk.locations.map(loc => () => agent(bundlePrompt(loc), { label: `loc:${loc.id}`, schema: BUNDLE_SCHEMA, agentType: 'general-purpose' }))
)).filter(Boolean)

log(`Got ${bundles.length}/${sk.locations.length} location bundles.`)
return { aiConfig, bundles }
