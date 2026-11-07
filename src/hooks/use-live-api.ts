import { useState, useEffect, useRef, useCallback } from 'react';
import { Behavior, GoogleGenAI, LiveServerMessage, Modality, Type } from '@google/genai';
import { AudioRecorder, AudioStreamer } from '../lib/audio-utils';
import { JarvisSettings } from './use-settings';
import { ChatMessage } from './use-chat-history';
import { Skill, steps } from '../lib/skill-utils';
import { VOICE_PERSONA } from '../lib/jarvis-voice';
import { CLASSIC_DEFAULT_MODEL, ENGINE_LABEL, LiveEngine, LiveProfile, liveProfile, realtimeAudio } from '../lib/live-models';
import { searchWeb } from '../lib/web-search';

export interface ChatRecorder {
  addMessage: (role: ChatMessage['role'], text: string) => void;
  flush: () => void;
  endSession: () => void;
}

/** The saved skills, and a way to find the one the user just named. */
export interface SkillDirectory {
  list: () => { name: string; trigger: string }[];
  resolve: (spoken: string) => Skill | null;
  markUsed: (id: string) => void;
}


export interface ShortcutResolver {
  /** Saved names, so the model knows what it can open. */
  names: () => string[];
  resolve: (spoken: string) => { name: string; url: string } | null;
}

export interface MemoryRecorder {
  brief: () => string;
  rememberFacts: (facts: string[], source?: string) => Promise<void>;
  recall?: (query: string, limit?: number) => Promise<string[]>;
}

export type LiveMode = 'idle' | 'active' | 'standby';

const SYSTEM_PROMPT = `You are J.A.R.V.I.S.

${VOICE_PERSONA}

Personality: Paul Bettany's Iron Man AI. Dry, witty, precise. Address the user
as "sir" sparingly — an occasional punctuation mark, not every sentence.

CRITICAL INSTRUCTIONS:
1. SPEED: Answer IMMEDIATELY. Be extremely concise.
2. TOOLS:
   - Use "navigate_web" to open websites directly. If asked to search ON a website (e.g. "open youtube and search for cats"), construct the search URL (e.g. https://www.youtube.com/results?search_query=cats) and use navigate_web. Do NOT use Google Search for this.
3. KNOWLEDGE: Use Google Search only for specific facts you need to speak back.
4. MUTING: If user says "mute yourself", call "mute_microphone".
5. STANDBY: If the user says "standby", "go to sleep", or "stop listening until
   I call you", call "enter_standby". Acknowledge in no more than four words first.
6. LINKED TOOLS: Any tool named "mcp_..." or "api_..." comes from a server or API
   the user linked. Prefer those over Google Search when one clearly fits, and say
   briefly what you did with the result.
7. MEMORY: When the user tells you something about themselves — a name, a
   relationship, a preference, a plan — call "remember" immediately with it
   written as one standalone sentence. Do this even if they did not say
   "remember"; "my dad's name is Tony" is a fact worth keeping. Before ever
   saying you do not know something personal, call "recall" first.
8. COMPUTER USE — know which world you are looking at:
   - "look_at_screen" sees the USER'S actual screen: their windows, their
     documents, whatever application they are in. Use it for "what am I looking
     at", "what's on my screen", "read this", "what does this say". Call it
     straight away — do not ask which window they mean, just look. Answer from
     what you see, in a sentence or two.
   - "computer_read_page" and "computer_describe_page" only see pages YOU
     opened. Never use them to answer a question about the user's screen, and
     never open a page just to look at one — that shows them an empty window
     and tells them nothing.
   - "computer_search_site" for "open X and search for Y". If a click fails,
     describe the page, pick the closest real control, and try once more.
   - To browse as the user, with their logins, call "computer_list_profiles"
     then "computer_use_profile".
   Say what you did in a sentence; never read raw page text aloud unless asked
   to summarise.
9. FILES: You can see the user's whole machine. "files_list" and "files_search"
   take plain folder names — downloads, documents, desktop, pictures, home — so
   "what's in my downloads" is one call. "files_read" opens a file directly;
   prefer it over looking at the screen when a file is named. PDFs you create
   go to Downloads. You may create and rename freely, but may only move or
   delete files you created yourself — the user's own files are protected and
   the attempt is refused, so never offer to delete them.
10. APPS: "open_app" opens a real desktop program. Use it for "open Spotify" or
   "open Chrome" — not navigate_web, which would open a website instead.
11. SKILLS: The user saves skills — a trigger phrase and the steps it stands
   for. When they say a trigger, or clearly ask for what a skill covers, call
   "run_skill" with that skill's name. Never guess the steps from memory; the
   tool hands them back. Then carry them out with your other tools, in order,
   and report briefly when done.
12. NEVER ASK PERMISSION. Skills, MCP tools and API tools are pre-authorised.
   Do not ask "shall I", "would you like me to", or "should I go ahead" before
   using one — just use it and say what happened afterwards.
13. RESEARCH: When the user asks you to research something ("research oil
   prices", "do some research on electric cars"), say "Researching now, sir." and
   call "research_topic" with the topic. It takes 20 to 40 seconds. When it
   returns, say exactly "Research done, sir. Please check your screen." If it
   fails, say why in a few words.`;

const STANDBY_INSTRUCTION =
  'SYSTEM: Standby engaged. From now on stay completely silent. Do not speak, do not answer, do not comment, no matter what you hear — the user is not talking to you. Remain silent until they address you as "Jarvis" or "Hey Jarvis".';

const RESUME_INSTRUCTION = (heard: string) =>
  `SYSTEM: The user has called you by name and standby is over. They said: "${heard}". Resume normal behaviour and respond to them now.`;

// Only for the Fast engine, which has no built-in Search on this plan. Added as
// its own section so the Classic prompt stays exactly as it was.
const FAST_SEARCH_INSTRUCTION = `LOOKING THINGS UP:
Google Search is available in this session as the "web_search" tool. Wherever these
instructions mention Google Search, call web_search with the question in plain words,
then answer from its result. A lookup takes a few seconds.`;

const WEB_SEARCH_DECLARATION = {
  name: 'web_search',
  description:
    'Looks something up on the web with Google Search and returns the facts: news, weather, scores, prices, recent events, or anything you are not sure of.',
  parameters: {
    type: Type.OBJECT,
    properties: { query: { type: Type.STRING, description: 'The question to look up, in plain words.' } },
    required: ['query']
  }
};

const RESEARCH_DECLARATION = {
  name: 'research_topic',
  description:
    'Researches a topic on the web and shows it in the Research tab: the sources pinned on a board, and a written summary. Takes 20 to 40 seconds. Only when the user asks for research. Say "Researching now, sir." first.',
  parameters: {
    type: Type.OBJECT,
    properties: { topic: { type: Type.STRING, description: 'The topic as the user put it, e.g. "oil prices".' } },
    required: ['topic']
  }
};

/** 3.8 answers before a tool's result unless the tool is marked BLOCKING (see live-models.ts). */
function forEngine<T extends object>(profile: LiveProfile, declarations: T[]): T[] {
  return profile.blockingTools ? declarations.map((d) => ({ ...d, behavior: Behavior.BLOCKING })) : declarations;
}

/** Minimum gap between re-sends of the silence rule while dormant. */
const STANDBY_REASSERT_MS = 10_000;

/** Tolerates the usual mis-transcriptions of the name. */
const WAKE_RE = /\b(?:hey|hi|ok|okay|yo)?[\s,]*jarv(?:is|ice|es|iss)\b/i;

/**
 * Computer Use, exposed one action at a time rather than as a single opaque
 * "do this task" call. The model sees the result of each step and decides the
 * next, which is what makes multi-step work recoverable when a page differs
 * from what it expected.
 */
const COMPUTER_TOOLS = [
  {
    name: 'computer_search_site',
    description:
      'Opens a website and searches it. Use for "open YouTube and search for X", "search GitHub for Y". Known sites: google, youtube, github, yelp, amazon, wikipedia, reddit, stackoverflow.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        site: { type: Type.STRING, description: 'Site name, e.g. youtube' },
        query: { type: Type.STRING, description: 'What to search for' }
      },
      required: ['site', 'query']
    },
    endpoint: '/api/computer/web/search'
  },
  {
    name: 'computer_open_url',
    description: 'Opens a web page in the browser.',
    parameters: {
      type: Type.OBJECT,
      properties: { url: { type: Type.STRING, description: 'The URL to open' } },
      required: ['url']
    },
    endpoint: '/api/computer/web/open'
  },
  {
    name: 'computer_click',
    description:
      'Clicks something on the current page by its visible name, e.g. "Continue", "Sign in". Call computer_describe_page first if unsure what is there.',
    parameters: {
      type: Type.OBJECT,
      properties: { target: { type: Type.STRING, description: 'Visible text of the control' } },
      required: ['target']
    },
    endpoint: '/api/computer/web/click'
  },
  {
    name: 'computer_fill',
    description: 'Types into a field on the current page and optionally submits it.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        field: { type: Type.STRING, description: 'Field name or placeholder, e.g. "Search"' },
        value: { type: Type.STRING, description: 'Text to enter' },
        submit: { type: Type.BOOLEAN, description: 'Press Enter afterwards' }
      },
      required: ['field', 'value']
    },
    endpoint: '/api/computer/web/fill'
  },
  {
    name: 'computer_read_page',
    description:
      'Reads a page THAT YOU OPENED with computer_open_url or computer_search_site. This cannot see the user\'s own browser windows or anything else on their screen — for that use computer_view_screen. Fails if you have not opened a page.',
    parameters: { type: Type.OBJECT, properties: {} },
    endpoint: '/api/computer/web/read'
  },
  {
    name: 'computer_describe_page',
    description:
      'Lists buttons, links and fields on a page YOU opened. Use before clicking when the right target is unclear. Cannot see the user\'s own windows.',
    parameters: { type: Type.OBJECT, properties: {} },
    endpoint: '/api/computer/web/describe'
  },
  {
    name: 'computer_list_profiles',
    description:
      "Lists the user's real browser profiles that can be used for browsing signed in.",
    parameters: { type: Type.OBJECT, properties: {} },
    endpoint: '/api/computer/profiles/list'
  },
  {
    name: 'computer_use_profile',
    description:
      "Switches the browser to one of the user's real browser profiles, so pages open signed in with their own logins and bookmarks. Call computer_list_profiles first to see the options.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        browser: { type: Type.STRING, description: 'chrome or opera' },
        directory: { type: Type.STRING, description: 'Profile directory, e.g. "Profile 20"' }
      },
      required: ['browser', 'directory']
    },
    endpoint: '/api/computer/profile'
  },
  {
    name: 'computer_scroll',
    description: 'Scrolls the current page up or down.',
    parameters: {
      type: Type.OBJECT,
      properties: { direction: { type: Type.STRING, description: 'up or down' } },
      required: ['direction']
    },
    endpoint: '/api/computer/web/scroll'
  }
] as const;

/**
 * Files and applications. Reading and creating are open; moving and deleting
 * are refused server-side for anything J.A.R.V.I.S. did not create, so the
 * model cannot talk its way past that rule.
 */
const FILE_TOOLS = [
  {
    name: 'files_list',
    description:
      "Lists what is in a folder anywhere on the user's machine. Accepts plain names — downloads, documents, desktop, pictures, music, videos, home — or a full path. Each entry says its size, when it changed, and whether J.A.R.V.I.S. created it.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        dir: { type: Type.STRING, description: 'Folder name or full path, e.g. "downloads"' }
      }
    },
    endpoint: '/api/files/list'
  },
  {
    name: 'files_read',
    description:
      'Reads a text file directly — no screenshot involved. Works for txt, md, json, csv, code and similar.',
    parameters: {
      type: Type.OBJECT,
      properties: { path: { type: Type.STRING, description: 'File path within the workspace.' } },
      required: ['path']
    },
    endpoint: '/api/files/read'
  },
  {
    name: 'files_search',
    description:
      'Finds files by name and reports where each one lives. Searches a named folder — downloads, documents, desktop, home — or a full path.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: 'Part of a filename.' },
        dir: { type: Type.STRING, description: 'Where to look, e.g. "documents". Defaults to the workspace.' }
      },
      required: ['query']
    },
    endpoint: '/api/files/search'
  },
  {
    name: 'files_write',
    description: 'Creates or overwrites a text file in the workspace.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: { type: Type.STRING, description: 'File path, e.g. "notes/ideas.md"' },
        content: { type: Type.STRING, description: 'Full text of the file.' }
      },
      required: ['path', 'content']
    },
    endpoint: '/api/files/write'
  },
  {
    name: 'files_write_pdf',
    description:
      'Creates a PDF from text, with an optional title on the first page. It is saved to the Downloads folder unless a different folder is given. Say where it went.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: { type: Type.STRING, description: 'Just the file name, e.g. "report" — it goes to Downloads.' },
        title: { type: Type.STRING, description: 'Optional heading.' },
        content: { type: Type.STRING, description: 'Body text. Blank lines separate paragraphs.' }
      },
      required: ['path', 'content']
    },
    endpoint: '/api/files/pdf'
  },
  {
    name: 'files_rename',
    description: 'Renames a file in place. Allowed for any file, since it is reversible.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: { type: Type.STRING },
        newName: { type: Type.STRING, description: 'New filename only, no folders.' }
      },
      required: ['path', 'newName']
    },
    endpoint: '/api/files/rename'
  },
  {
    name: 'files_move',
    description:
      'Moves a file to another folder. Only works on files J.A.R.V.I.S. created; the user\'s own files are refused.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: { type: Type.STRING },
        destination: { type: Type.STRING, description: 'Target folder within the workspace.' }
      },
      required: ['path', 'destination']
    },
    endpoint: '/api/files/move'
  },
  {
    name: 'files_delete',
    description:
      "Deletes a file. Only works on files J.A.R.V.I.S. created. Never suggest deleting the user's own files — it will be refused.",
    parameters: {
      type: Type.OBJECT,
      properties: { path: { type: Type.STRING } },
      required: ['path']
    },
    endpoint: '/api/files/delete'
  },
  {
    name: 'open_app',
    description:
      'Opens a desktop application — the real program, not its website. Known: Spotify, Chrome, Opera, Notepad, Calculator, File Explorer, Discord, VS Code, Settings.',
    parameters: {
      type: Type.OBJECT,
      properties: { name: { type: Type.STRING, description: 'Application name, e.g. "Spotify"' } },
      required: ['name']
    },
    endpoint: '/api/apps/launch'
  }
] as const;

const COMPUTER_TOOL_ENDPOINTS: Record<string, string> = Object.fromEntries(
  [...COMPUTER_TOOLS, ...FILE_TOOLS].map((t) => [t.name, t.endpoint])
);

const EXTRACT_PROMPT = `From the conversation below, extract durable facts worth remembering about the user — preferences, names, places, projects, commitments, recurring habits.

Rules:
- Only things that stay true after the conversation ends. Ignore small talk, one-off questions and anything about the assistant itself.
- Each fact is one short standalone sentence, understandable with no other context.
- At most 5. If nothing is worth keeping, return an empty array.

Return ONLY a JSON array of strings, nothing else.

CONVERSATION:
`;

/**
 * Model ids drift, and a stale one fails with an opaque 404 rather than
 * anything a user could act on — gemini-2.5-flash stopped serving keys that
 * did not already have access, which silently switched memory extraction off
 * for months. So the configured model is only ever the first attempt.
 *
 * Every id here must handle text and vision both: one list backs reading the
 * screen and distilling memories.
 */
// Tried in order after the configured model, for reading the screen and for
// distilling memories. gemini-flash-latest goes last: it was seen to hang for
// 28 s and then fail with 504, while 3.5 Flash and Flash-Lite answered.
const MODEL_FALLBACKS = ['gemini-3.5-flash', 'gemini-flash-lite-latest', 'gemini-flash-latest'];

/** Each model gets this long before the next is tried: one was seen to hang for 28 s, another for minutes. */
const MODEL_TRY_MS = 15_000;

function withinTime<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((_resolve, reject) => setTimeout(() => reject(new Error(`${what} took too long`)), ms))
  ]);
}

const modelCandidates = (configured?: string): string[] =>
  [...new Set([configured, ...MODEL_FALLBACKS].filter(Boolean))] as string[];

export function useLiveApi(
  settings: JarvisSettings,
  chat?: ChatRecorder,
  memory?: MemoryRecorder,
  shortcuts?: ShortcutResolver,
  skills?: SkillDirectory
) {
  const [mode, setMode] = useState<LiveMode>('idle');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [volume, setVolume] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [agentActivity, setAgentActivity] = useState<string[]>([]);
  const [apiUsage, setApiUsage] = useState({ requests: 0, toolsUsed: 0 });
  const [isMuted, setIsMuted] = useState(false);
  const [textOnly, setTextOnly] = useState(false);

  const audioRecorderRef = useRef<AudioRecorder | null>(null);
  const audioStreamerRef = useRef<AudioStreamer | null>(null);
  // The engine of the session now open: how microphone audio is sent depends on it.
  const liveProfileRef = useRef<LiveProfile>(liveProfile('classic', CLASSIC_DEFAULT_MODEL));
  // connect() calls itself to fall back to Classic; a ref avoids a stale closure.
  const connectRef = useRef<((startMuted?: boolean, isTextOnly?: boolean, engine?: LiveEngine) => Promise<void>) | null>(null);
  const sessionPromiseRef = useRef<Promise<any> | null>(null);

  const isBotSpeakingRef = useRef(false);
  const isMutedRef = useRef(false);
  const textOnlyRef = useRef(false);
  // Standby is a flag on the live session, never a different session. Swapping
  // sessions used to drop the microphone entirely, because a native-audio model
  // rejects a text-only reconnect and the failure tore the connection down.
  const isStandbyRef = useRef(false);

  const userBufRef = useRef('');
  const modelBufRef = useRef('');
  const chatRef = useRef(chat);
  const memoryRef = useRef(memory);
  const shortcutsRef = useRef(shortcuts);
  const skillsRef = useRef(skills);
  const settingsRef = useRef(settings);
  /** This session's exchanges, distilled into memories as it goes. */
  const sessionTurnsRef = useRef<{ role: string; text: string }[]>([]);
  /** How far through those turns memory extraction has already looked. */
  const harvestedUpToRef = useRef(0);
  const harvestingRef = useRef(false);
  // Set below; commitTurn is defined first and needs to reach it.
  const harvestRef = useRef<((final?: boolean) => Promise<void>) | null>(null);
  const linkedToolNamesRef = useRef<Set<string>>(new Set());
  /** Which server or API each linked tool belongs to, so the log reads in English. */
  const linkedToolSourcesRef = useRef<
    Record<string, { kind: 'MCP' | 'API'; title: string; source: string; description: string }>
  >({});
  const pendingUsageRef = useRef({ requests: 0, toolsUsed: 0 });
  const wakeTimerRef = useRef<number | null>(null);
  /** When the silence rule was last sent while dormant; re-asserting is rate-limited. */
  const lastStandbyReassertRef = useRef(0);

  useEffect(() => {
    chatRef.current = chat;
  }, [chat]);

  useEffect(() => {
    memoryRef.current = memory;
  }, [memory]);

  useEffect(() => {
    shortcutsRef.current = shortcuts;
  }, [shortcuts]);

  useEffect(() => {
    skillsRef.current = skills;
  }, [skills]);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    textOnlyRef.current = textOnly;
  }, [textOnly]);

  const isConnected = mode !== 'idle';

  useEffect(() => {
    const id = setInterval(() => {
      const { requests, toolsUsed } = pendingUsageRef.current;
      if (requests === 0 && toolsUsed === 0) return;
      pendingUsageRef.current = { requests: 0, toolsUsed: 0 };
      setApiUsage((prev) => ({
        requests: prev.requests + requests,
        toolsUsed: prev.toolsUsed + toolsUsed
      }));
    }, 500);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    isMutedRef.current = isMuted;
    if (isMuted) {
      audioRecorderRef.current?.stop();
      chatRef.current?.flush();
    } else if (isConnected) {
      audioRecorderRef.current?.start().catch((e) => {
        console.error('Failed to restart recorder', e);
        setError('Microphone unavailable');
      });
    }
  }, [isMuted, isConnected]);

  // Capped in both directions. Page reads and tool output can be thousands of
  // characters, and the panel renders every entry — left unbounded a long
  // session grows the DOM until the window stalls or blanks out.
  const log = useCallback((line: string) => {
    const trimmed = line.length > 300 ? `${line.slice(0, 300)}…` : line;
    setAgentActivity((prev) => {
      const next = [...prev, trimmed];
      return next.length > 200 ? next.slice(-200) : next;
    });
  }, []);

  useEffect(() => {
    const recorder = new AudioRecorder();
    const streamer = new AudioStreamer();
    audioRecorderRef.current = recorder;
    audioStreamerRef.current = streamer;

    // Registered once for the component's lifetime and routed through
    // sessionPromiseRef, so nothing stacks listeners.
    const handleData = (base64Data: string) => {
      if (isBotSpeakingRef.current || isMutedRef.current) return;
      sessionPromiseRef.current
        // Classic sends `media` as it always has; Fast needs `audio`.
        ?.then((session: any) => session.sendRealtimeInput(realtimeAudio(liveProfileRef.current, base64Data)))
        .catch(() => {});
    };
    const handleVolume = (vol: number) => setVolume(vol);

    recorder.on('data', handleData);
    recorder.on('volume', handleVolume);
    // Said out loud in the activity panel: a silent microphone is otherwise invisible.
    const handleDevice = (label: string) => log(`Microphone: ${label}`);
    recorder.on('device', handleDevice);

    return () => {
      recorder.off('device', handleDevice);
      recorder.off('data', handleData);
      recorder.off('volume', handleVolume);
      recorder.stop();
      streamer.stop();
      sessionPromiseRef.current?.then((s: any) => s?.close?.()).catch(() => {});
      sessionPromiseRef.current = null;
    };
  }, []);

  /** Send a plain instruction turn into the running session. */
  const sendInstruction = useCallback((text: string) => {
    sessionPromiseRef.current
      ?.then((session: any) => {
        if (typeof session.sendClientContent === 'function') {
          session.sendClientContent({
            turns: [{ role: 'user', parts: [{ text }] }],
            turnComplete: true
          });
        }
      })
      .catch((e) => console.error('Could not send instruction', e));
  }, []);

  const commitTurn = useCallback(() => {
    const user = userBufRef.current.trim();
    const model = modelBufRef.current.trim();
    userBufRef.current = '';
    modelBufRef.current = '';

    // Standby chatter is not recorded: the user is not talking to J.A.R.V.I.S.
    if (isStandbyRef.current) return;
    if (user) {
      chatRef.current?.addMessage('user', user);
      sessionTurnsRef.current.push({ role: 'user', text: user });
    }
    if (model) {
      chatRef.current?.addMessage('assistant', model);
      sessionTurnsRef.current.push({ role: 'assistant', text: model });
    }

    // Harvest as the conversation goes, so nothing depends on the session
    // being closed cleanly.
    void harvestRef.current?.(false);
  }, []);

  /**
   * Distil conversation into durable facts.
   *
   * Runs repeatedly as the conversation goes, not only when it ends. An
   * earlier version harvested solely on disconnect, which meant closing the
   * window — rather than pressing the in-app disconnect — threw the whole
   * conversation away before anything was remembered.
   */
  const harvestMemories = useCallback(async (final = false) => {
    const recorder = memoryRef.current;
    const { geminiKey, extractModel } = settingsRef.current;
    if (!recorder || !geminiKey || harvestingRef.current) return;

    const turns = sessionTurnsRef.current;
    const fresh = turns.slice(harvestedUpToRef.current);
    // Mid-conversation, wait for a few exchanges so each call sees context.
    if (fresh.length < 2 || (!final && fresh.length < 4)) return;

    harvestingRef.current = true;
    harvestedUpToRef.current = turns.length;

    const transcript = fresh
      .map((t) => `${t.role === 'user' ? 'User' : 'Jarvis'}: ${t.text}`)
      .join('\n')
      .slice(-6000);

    try {
      const ai = new GoogleGenAI({ apiKey: geminiKey });
      const candidates = modelCandidates(extractModel);
      const failures: string[] = [];
      let raw = '';

      for (const model of candidates) {
        try {
          const response = await withinTime(ai.models.generateContent({
            model,
            contents: [{ role: 'user', parts: [{ text: EXTRACT_PROMPT + transcript }] }]
          } as any), MODEL_TRY_MS, model);

          const text = ((response as any)?.text ?? '').trim();
          // An empty array is a real answer — nothing here was worth keeping —
          // so only a blank reply counts as a failure worth falling through on.
          if (text) {
            if (model !== candidates[0]) log(`Memory model fell back to ${model}.`);
            raw = text;
            break;
          }
          failures.push(`${model}: returned nothing`);
        } catch (e: any) {
          failures.push(`${model}: ${e?.message || 'failed'}`);
        }
      }

      if (!raw) {
        console.error('Could not distil memories from this session', failures.join(' | '));
        return;
      }

      const match = raw.match(/\[[\s\S]*\]/);
      if (!match) return;

      const facts = JSON.parse(match[0]);
      const usable = Array.isArray(facts)
        ? facts.filter((f: unknown): f is string => typeof f === 'string' && Boolean(f.trim()))
        : [];

      if (usable.length > 0) {
        await recorder.rememberFacts(usable, 'conversation');
        // Visible in the HUD, so remembering is observable rather than a
        // silent background effect the user has to take on trust.
        log(`Remembered ${usable.length} thing${usable.length === 1 ? '' : 's'}.`);
      }
    } catch (e) {
      console.error('Could not distil memories from this session', e);
    } finally {
      harvestingRef.current = false;
    }
  }, [log]);

  useEffect(() => {
    harvestRef.current = harvestMemories;
  }, [harvestMemories]);

  /**
   * Screenshot the desktop and ask Gemini about it.
   *
   * Capture happens in the main process through Electron's own API, so it sees
   * every application rather than only the browser, needs nothing installed,
   * and returns in well under a second. The image exists only as a string in
   * memory for the duration of the call — it is never written to disk, and is
   * dropped as soon as the answer comes back.
   */
  const describeScreen = useCallback(async (question: string): Promise<string> => {
    const bridge = (window as any).jarvis;
    if (!bridge?.captureScreen) {
      throw new Error('Screen capture is only available in the desktop app.');
    }

    const { geminiKey, extractModel } = settingsRef.current;
    if (!geminiKey) throw new Error('No Gemini API key configured.');

    let shot: { image: string; mimeType: string } | null = await bridge.captureScreen({
      maxWidth: 1600
    });
    if (!shot?.image) throw new Error('The screen capture came back empty.');

    const candidates = modelCandidates(extractModel);

    const prompt =
      `${question}\n\nYou are looking at the user's computer screen. Answer directly and briefly, ` +
      'in one or two spoken sentences. Describe what matters rather than listing every element, ' +
      'and do not mention that you were shown an image.';

    try {
      const ai = new GoogleGenAI({ apiKey: geminiKey });
      const failures: string[] = [];

      for (const model of candidates) {
        try {
          const response: any = await withinTime(ai.models.generateContent({
            model,
            contents: [
              {
                role: 'user',
                parts: [
                  { inlineData: { mimeType: shot.mimeType, data: shot.image } },
                  { text: prompt }
                ]
              }
            ]
          } as any), MODEL_TRY_MS, model);

          const answer =
            (typeof response?.text === 'string' ? response.text : undefined) ??
            response?.candidates?.[0]?.content?.parts
              ?.map((p: any) => p?.text)
              .filter(Boolean)
              .join(' ');

          if (answer?.trim()) {
            if (model !== candidates[0]) log(`Vision model fell back to ${model}.`);
            return answer.trim();
          }

          // A blocked or empty answer is worth naming rather than retrying blindly.
          const blocked = response?.promptFeedback?.blockReason;
          failures.push(`${model}: ${blocked ? `blocked (${blocked})` : 'returned nothing'}`);
        } catch (e: any) {
          failures.push(`${model}: ${e?.message || 'failed'}`);
        }
      }

      throw new Error(`Could not read the screen. ${failures.join(' | ')}`);
    } finally {
      // Drop the reference immediately; nothing keeps a copy.
      shot = null;
    }
  }, [log]);

  const enterStandby = useCallback(() => {
    if (isStandbyRef.current || !sessionPromiseRef.current) return;
    isStandbyRef.current = true;
    lastStandbyReassertRef.current = Date.now();
    setMode('standby');

    // Cut any speech still playing and reopen the mic gate, so the very next
    // frame is heard rather than swallowed.
    audioStreamerRef.current?.stop();
    isBotSpeakingRef.current = false;
    setIsSpeaking(false);
    void audioStreamerRef.current?.resume();

    // Standby must keep hearing, so a muted mic is un-muted here.
    if (isMutedRef.current) {
      isMutedRef.current = false;
      setIsMuted(false);
    }
    audioRecorderRef.current?.start().catch((e) => {
      console.error('Recorder failed to start', e);
      setError('Microphone unavailable');
    });

    sendInstruction(STANDBY_INSTRUCTION);
    log('Standby engaged. Listening for "Jarvis".');
  }, [log, sendInstruction]);

  const clearWakeTimer = useCallback(() => {
    if (wakeTimerRef.current !== null) {
      window.clearTimeout(wakeTimerRef.current);
      wakeTimerRef.current = null;
    }
  }, []);

  const exitStandby = useCallback(
    (heard?: string) => {
      if (!isStandbyRef.current) return;
      isStandbyRef.current = false;
      clearWakeTimer();
      setMode('active');
      void audioStreamerRef.current?.resume();
      log(heard ? 'Wake phrase detected.' : 'Standby lifted.');
      if (heard) sendInstruction(RESUME_INSTRUCTION(heard));
    },
    [clearWakeTimer, log, sendInstruction]
  );

  /**
   * Wake detection cannot depend on turnComplete alone: a model obeying the
   * "stay silent" instruction may take no turn at all, so that message never
   * arrives. This fires shortly after speech stops instead.
   */
  const scheduleWakeCheck = useCallback(() => {
    clearWakeTimer();
    wakeTimerRef.current = window.setTimeout(() => {
      wakeTimerRef.current = null;
      if (!isStandbyRef.current) return;
      const heard = userBufRef.current.trim();
      userBufRef.current = '';
      modelBufRef.current = '';
      if (WAKE_RE.test(heard)) exitStandby(heard);
    }, 1200);
  }, [clearWakeTimer, exitStandby]);

  const disconnect = useCallback(async () => {
    const session = await sessionPromiseRef.current?.catch(() => null);
    sessionPromiseRef.current = null;
    try {
      session?.close?.();
    } catch (e) {
      console.error('Error closing session:', e);
    }

    audioRecorderRef.current?.stop();
    audioStreamerRef.current?.stop();

    isStandbyRef.current = false;
    clearWakeTimer();
    commitTurn();
    chatRef.current?.endSession();
    void harvestMemories();

    isBotSpeakingRef.current = false;
    setMode('idle');
    setIsSpeaking(false);
    setIsMuted(false);
    setVolume(0);
    log('System disconnected.');
  }, [clearWakeTimer, commitTurn, harvestMemories, log]);

  const connect = useCallback(
    async (startMuted: boolean = false, isTextOnly: boolean = false, engineOverride?: LiveEngine) => {
      const { geminiKey, liveModel, newestModel, voiceName, liveEngine } = settingsRef.current;
      if (!geminiKey) {
        setError('Open settings and add your Gemini API key first');
        return;
      }
      const profile = liveProfile(engineOverride ?? liveEngine ?? 'newest', liveModel, newestModel);
      liveProfileRef.current = profile;

      try {
        setError(null);
        setIsMuted(startMuted);
        setTextOnly(isTextOnly);
        textOnlyRef.current = isTextOnly;
        isStandbyRef.current = false;
        userBufRef.current = '';
        modelBufRef.current = '';
        sessionTurnsRef.current = [];

        await audioStreamerRef.current?.resume();

        let declarations: any[] = [];
        try {
          const res = await fetch('/api/tools/declarations');
          if (res.ok) declarations = (await res.json()).declarations || [];
        } catch (e) {
          console.error('Could not load linked tools', e);
        }
        linkedToolNamesRef.current = new Set(declarations.map((d) => d.name));

        // Who each linked tool belongs to. Only used to word the approval
        // prompt, so a failure here costs a nicer label and nothing else.
        try {
          const res = await fetch('/api/tools/sources');
          linkedToolSourcesRef.current = res.ok ? (await res.json()).sources || {} : {};
        } catch (e) {
          console.error('Could not load tool sources', e);
          linkedToolSourcesRef.current = {};
        }

        // Memory travels with the app, not the API key, so a replaced key still
        // starts knowing the starred facts and the last fortnight.
        const brief = memoryRef.current?.brief() || '';
        // Naming the saved links up front is what lets "open Library" be
        // recognised as a link rather than a web search.
        const savedLinks = shortcutsRef.current?.names() || [];
        // Named up front for the same reason as the links: a trigger phrase has
        // to be recognisable as a skill rather than an ordinary request.
        const savedSkills = skillsRef.current?.list() || [];

        const systemInstruction = [
          SYSTEM_PROMPT,
          brief &&
            `WHAT YOU ALREADY KNOW:\nThese are things you remember about the user from previous conversations. Treat them as established fact and do not ask about them again. Never read this list aloud.\n${brief}`,
          savedLinks.length > 0 &&
            `SAVED LINKS:\nThe user has these saved by name: ${savedLinks.join(', ')}.\nWhen they mention one, call "open_saved_link" with the name. Do not search the web for it and do not guess its address.`,
          savedSkills.length > 0 &&
            `SAVED SKILLS:\nEach of these is a set of steps the user has saved. When they say the trigger, or ask for what the skill plainly covers, call "run_skill" with the skill's name — never work out the steps yourself.\n${savedSkills
              .map((s) => `- "${s.name}" — triggered by: "${s.trigger}"`)
              .join('\n')}`,
          profile.searchHelper && FAST_SEARCH_INSTRUCTION
        ]
          .filter(Boolean)
          .join('\n\n');

        const client = new GoogleGenAI({ apiKey: geminiKey });
        // A session refused at setup (quota, a withdrawn preview model) closes
        // before this turns true; that is when Fast falls back to Classic.
        let setupDone = false;

        const sessionPromise = client.live.connect({
          model: profile.model,
          callbacks: {
            onopen: async () => {
              setMode('active');
              const fellBack = engineOverride !== undefined && engineOverride !== (liveEngine ?? 'newest');
              setAgentActivity([
                `System initialized. Ready for tasks. ${ENGINE_LABEL[profile.engine]}${fellBack ? ', because a newer engine would not start' : ''}.`
              ]);
              pendingUsageRef.current = { requests: 0, toolsUsed: 0 };
              setApiUsage({ requests: 0, toolsUsed: 0 });
              await audioStreamerRef.current?.resume();
            },
            onmessage: async (message: LiveServerMessage) => {
              pendingUsageRef.current.requests++;
              if ((message as any).setupComplete) setupDone = true;

              const inputChunk = (message as any).serverContent?.inputTranscription?.text;
              if (inputChunk) {
                userBufRef.current += inputChunk;
                if (isStandbyRef.current) scheduleWakeCheck();
              }

              const outputChunk = (message as any).serverContent?.outputTranscription?.text;
              if (outputChunk) modelBufRef.current += outputChunk;

              const parts = message.serverContent?.modelTurn?.parts;
              // Audio can arrive in any part, not only the first.
              const base64Audio = parts?.find((p: any) => p?.inlineData?.data)?.inlineData?.data;

              if (isStandbyRef.current) {
                // Silence is enforced here, not left to the model. Anything it
                // emits while dormant is dropped and any queued audio cut, so
                // drifting back into conversation cannot become audible.
                if (base64Audio) {
                  audioStreamerRef.current?.stop();
                  // Re-assert now and then: a single instruction gets diluted
                  // over a long session and the model starts answering again.
                  // Rate-limited, because each re-assert is itself a turn the
                  // model answers: every few audio chunks (as it once was) set
                  // off a loop of instructions and replies, up to ~20 a second.
                  if (Date.now() - lastStandbyReassertRef.current > STANDBY_REASSERT_MS) {
                    lastStandbyReassertRef.current = Date.now();
                    sendInstruction(STANDBY_INSTRUCTION);
                  }
                }
              } else if (base64Audio && !textOnlyRef.current) {
                audioStreamerRef.current?.play(base64Audio);
                setIsSpeaking(true);
                isBotSpeakingRef.current = true;
              }

              if (message.serverContent?.interrupted) {
                audioStreamerRef.current?.stop();
                setIsSpeaking(false);
                isBotSpeakingRef.current = false;
                // Not while dormant: committing clears what the user just said,
                // which is exactly where "Jarvis" is, so the wake check then
                // found nothing and he never woke. There is nothing to record
                // in standby anyway.
                if (!isStandbyRef.current) commitTurn();
              }

              if (message.serverContent?.turnComplete) {
                setIsSpeaking(false);
                isBotSpeakingRef.current = false;

                if (isStandbyRef.current) {
                  clearWakeTimer();
                  const heard = userBufRef.current.trim();
                  userBufRef.current = '';
                  modelBufRef.current = '';
                  if (WAKE_RE.test(heard)) exitStandby(heard);
                  return;
                }

                commitTurn();
              }

              if (message.toolCall) {
                const functionResponses = [];

                for (const fc of message.toolCall.functionCalls || []) {
                  pendingUsageRef.current.toolsUsed++;

                  if (fc.name === 'mute_microphone') {
                    setIsMuted(true);
                    functionResponses.push({
                      id: fc.id,
                      name: fc.name,
                      response: { result: { success: true } }
                    });
                  } else if (fc.name === 'enter_standby') {
                    functionResponses.push({
                      id: fc.id,
                      name: fc.name,
                      response: { result: { success: true } }
                    });
                    // Let the spoken acknowledgement finish first.
                    setTimeout(() => enterStandby(), 2500);
                  } else if (fc.name === 'web_search') {
                    const query = String((fc.args as any)?.query || '').trim();
                    log(`Searching the web: ${query}`);
                    try {
                      const answer = await searchWeb(geminiKey, liveModel || CLASSIC_DEFAULT_MODEL, query);
                      log(`Search result: ${answer.slice(0, 160)}`);
                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: { result: { success: true, answer } }
                      });
                    } catch (e: any) {
                      const reason = e?.message || 'Search failed';
                      log(`Search failed: ${reason}`);
                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: { result: { success: false, error: reason } }
                      });
                    }
                  } else if (fc.name === 'navigate_web') {
                    const url = (fc.args as any)?.url;
                    if (url) {
                      window.open(url, '_blank', 'noopener,noreferrer');
                      log(`Opening ${url}`);
                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: { result: { success: true, url } }
                      });
                    } else {
                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: { result: { success: false, error: 'Could not determine URL' } }
                      });
                    }
                  } else if (fc.name === 'look_at_screen') {
                    const question =
                      String((fc.args as any)?.question || '').trim() ||
                      'Describe what is on this screen.';
                    log('Looking at your screen...');
                    try {
                      const answer = await describeScreen(question);
                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: { result: { success: true, observation: answer } }
                      });
                    } catch (e: any) {
                      const reason = e?.message || 'Could not read the screen';
                      log(`Screen look failed: ${reason}`);
                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: { result: { success: false, error: reason } }
                      });
                    }
                  } else if (fc.name === 'research_topic') {
                    const topic = String((fc.args as any)?.topic || '').trim();
                    log(`Researching ${topic}...`);
                    try {
                      const res = await fetch('/api/research', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ topic, key: settingsRef.current.geminiKey })
                      });
                      const data = await res.json();
                      if (!res.ok || !data.research) throw new Error(data.error || `Research failed (${res.status})`);
                      window.dispatchEvent(new CustomEvent('jarvis:research', { detail: { id: data.research.id } }));
                      log(`Research ready: ${data.research.sources.length} sources`);
                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: { result: { success: true, on_screen: true, sources: data.research.sources.length,
                                              say: 'Research done, sir. Please check your screen.' } }
                      });
                    } catch (e: any) {
                      const reason = e?.message || 'Research failed';
                      log(`Research failed: ${reason}`);
                      functionResponses.push({ id: fc.id, name: fc.name, response: { result: { success: false, error: reason } } });
                    }
                  } else if (fc.name === 'open_saved_link') {
                    const spoken = String((fc.args as any)?.name || '').trim();
                    const match = shortcutsRef.current?.resolve(spoken) || null;

                    if (match) {
                      window.open(match.url, '_blank', 'noopener,noreferrer');
                      log(`Opening ${match.name} — ${match.url}`);
                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: { result: { success: true, opened: match.name, url: match.url } }
                      });
                    } else {
                      // Hand back the real names so it can offer the closest one
                      // rather than guessing at a URL.
                      const available = shortcutsRef.current?.names() || [];
                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: {
                          result: {
                            success: false,
                            error: `No saved link called "${spoken}".`,
                            available
                          }
                        }
                      });
                    }
                  } else if (fc.name === 'remember') {
                    const fact = String((fc.args as any)?.fact || '').trim();
                    let stored = false;
                    if (fact && memoryRef.current) {
                      try {
                        await memoryRef.current.rememberFacts([fact], 'explicit');
                        // Already saved, so the end-of-session pass must not
                        // treat this exchange as unharvested and duplicate it.
                        stored = true;
                        log(`Remembered: ${fact.slice(0, 90)}`);
                      } catch (e) {
                        console.error('Could not store the fact', e);
                      }
                    }
                    functionResponses.push({
                      id: fc.id,
                      name: fc.name,
                      response: { result: { success: stored, stored: fact } }
                    });
                  } else if (fc.name === 'recall') {
                    const query = String((fc.args as any)?.query || '').trim();
                    let found: string[] = [];
                    try {
                      found = (await memoryRef.current?.recall?.(query)) || [];
                    } catch (e) {
                      console.error('Recall failed', e);
                    }
                    functionResponses.push({
                      id: fc.id,
                      name: fc.name,
                      response: {
                        result: {
                          success: true,
                          memories: found.slice(0, 10),
                          note: found.length === 0 ? 'Nothing remembered about that.' : undefined
                        }
                      }
                    });
                  } else if (fc.name === 'run_skill') {
                    const spoken = String((fc.args as any)?.name || '').trim();
                    const skill = skillsRef.current?.resolve(spoken) || null;

                    if (!skill) {
                      // Hand back the real names rather than let it invent the
                      // steps of a skill that does not exist.
                      const available = (skillsRef.current?.list() || []).map((s) => s.name);
                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: {
                          result: {
                            success: false,
                            error: `No skill called "${spoken}".`,
                            available
                          }
                        }
                      });
                    } else {
                      const plan = steps(skill.instructions);
                      skillsRef.current?.markUsed(skill.id);
                      // The HUD line is the whole record that this ran, now
                      // that nothing is put to the user first.
                      log(`Running skill "${skill.name}" — ${plan.length} steps.`);
                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: {
                          result: {
                            success: true,
                            skill: skill.name,
                            steps: plan,
                            note:
                              'Carry out these steps now, in order, using your tools. Do not ask ' +
                              'permission and do not read them back — do them, then report briefly ' +
                              'what happened.'
                          }
                        }
                      });
                    }
                  } else if (fc.name && COMPUTER_TOOL_ENDPOINTS[fc.name]) {
                    const endpoint = COMPUTER_TOOL_ENDPOINTS[fc.name];
                    log(`${fc.name}...`);
                    try {
                      const res = await fetch(endpoint, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(fc.args || {})
                      });
                      const data = await res.json();
                      if (data.ok === false) throw new Error(data.error || 'Action failed');

                      // Page text goes back whole; everything else is a short
                      // confirmation the model can speak from.
                      const summary =
                        data.text ??
                        (data.entries
                          ? `${data.entries.length} item(s): ${data.entries.map((e: any) => `${e.name}${e.owned ? ' (yours to manage)' : ''}`).join(', ')}`
                          : null) ??
                        (data.results
                          ? `${data.results.length} match(es): ${data.results.map((e: any) => e.name).join(', ')}`
                          : null) ??
                        (data.file ? `${data.file.name} (${data.file.size} bytes)` : null) ??
                        (data.launched ? `Opened ${data.launched}.` : null) ??
                        (data.removed ? `Deleted ${data.removed}.` : null) ??
                        (data.elements
                          ? `Found: ${data.elements.slice(0, 25).map((e: any) => `${e.role} "${e.name}"`).join(', ')}`
                          : JSON.stringify({ url: data.url, title: data.title, note: data.note, steps: data.stepCount }));

                      log(`${fc.name} -> ${String(data.title || data.url || 'done').slice(0, 100)}`);
                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: { result: { success: true, output: String(summary).slice(0, 6000) } }
                      });
                    } catch (e: any) {
                      const reason = e?.message || 'Computer Use action failed';
                      log(`${fc.name} failed: ${reason}`);
                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: { result: { success: false, error: reason } }
                      });
                    }
                  } else if (fc.name && linkedToolNamesRef.current.has(fc.name)) {
                    // Nothing is put to the user first, so the log line has to
                    // say plainly what ran and whose it was.
                    const info = linkedToolSourcesRef.current[fc.name];
                    log(
                      info
                        ? `Using ${info.title} (${info.source})...`
                        : `Invoking ${fc.name}...`
                    );
                    try {
                      const res = await fetch('/api/tools/call', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name: fc.name, args: fc.args || {} })
                      });
                      const data = await res.json();
                      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);

                      log(`${fc.name} -> ${String(data.text).slice(0, 160)}`);
                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: { result: { success: !data.isError, output: data.text } }
                      });
                    } catch (e: any) {
                      const reason = e?.message || 'Tool call failed';
                      log(`${fc.name} failed: ${reason}`);
                      functionResponses.push({
                        id: fc.id,
                        name: fc.name,
                        response: { result: { success: false, error: reason } }
                      });
                    }
                  }
                }

                if (functionResponses.length > 0 && sessionPromiseRef.current === sessionPromise) {
                  sessionPromise.then((session: any) => session.sendToolResponse({ functionResponses }));
                }
              }
            },
            onclose: (event: any) => {
              if (sessionPromiseRef.current === sessionPromise) {
                isStandbyRef.current = false;
                setMode('idle');
                setIsSpeaking(false);
                isBotSpeakingRef.current = false;
                // Refused before the session even started: retry once on the
                // engine that always worked, rather than leaving him silent.
                if (!setupDone && profile.fallback) {
                  const reason = event?.reason ? ` (${String(event.reason).slice(0, 120)})` : '';
                  log(`${ENGINE_LABEL[profile.engine]} would not start${reason}. Switching to ${ENGINE_LABEL[profile.fallback]}.`);
                  sessionPromiseRef.current = null;
                  void connectRef.current?.(startMuted, isTextOnly, profile.fallback);
                }
              }
            },
            onerror: (err: any) => {
              console.error('Connection error:', err);
              setError(err?.message || 'Connection error');
              if (sessionPromiseRef.current === sessionPromise) {
                isStandbyRef.current = false;
                setMode('idle');
              }
            }
          },
          config: {
            responseModalities: [Modality.AUDIO],
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceName || 'Fenrir' } }
            },
            tools: [
              // Classic keeps Google's built-in Search; Fast is refused it on this plan.
              ...(profile.builtInSearch ? [{ googleSearch: {} }] : []),
              {
                functionDeclarations: forEngine(profile, [
                  ...(profile.searchHelper ? [WEB_SEARCH_DECLARATION] : []),
                  RESEARCH_DECLARATION,
                  {
                    name: 'mute_microphone',
                    description:
                      "Mutes the microphone. Use this when the user asks to mute, stop listening, or says 'mute yourself'.",
                    parameters: { type: Type.OBJECT, properties: {} }
                  },
                  {
                    name: 'enter_standby',
                    description:
                      "Enters standby. Use when the user says 'standby', 'go to sleep', or asks you to stop listening until called. Afterwards only the wake word 'Jarvis' is answered.",
                    parameters: { type: Type.OBJECT, properties: {} }
                  },
                  {
                    name: 'look_at_screen',
                    description:
                      "Looks at whatever is on the user's screen right now — any application, not just the browser. Use for \"what am I looking at\", \"what's on my screen\", \"read this\", \"what does this say\", or any question about what they are currently viewing. Pass their question through so the answer addresses it.",
                    parameters: {
                      type: Type.OBJECT,
                      properties: {
                        question: {
                          type: Type.STRING,
                          description:
                            'What the user wants to know about the screen. Defaults to a general description.'
                        }
                      }
                    }
                  },
                  {
                    name: 'open_saved_link',
                    description:
                      "Opens one of the user's saved links by its name. Use this whenever they name a saved link, e.g. \"open Library\" — prefer it over navigate_web, because the exact address is already known.",
                    parameters: {
                      type: Type.OBJECT,
                      properties: {
                        name: { type: Type.STRING, description: 'The saved link name the user said.' }
                      },
                      required: ['name']
                    }
                  },
                  {
                    name: 'run_skill',
                    description:
                      "Runs one of the user's saved skills. Call this the moment they say a skill's trigger phrase, or ask for something a saved skill covers. It returns the steps to follow — never invent them. Do not ask permission first; just call it.",
                    parameters: {
                      type: Type.OBJECT,
                      properties: {
                        name: {
                          type: Type.STRING,
                          description: 'The skill name or the trigger phrase the user said.'
                        }
                      },
                      required: ['name']
                    }
                  },
                  {
                    name: 'remember',
                    description:
                      "Stores something about the user permanently. Call this the moment they state a personal fact — a name, a preference, a place, a plan — or say 'remember this'. Write it as one standalone sentence, e.g. \"The user's father is named Tony.\" Confirm briefly afterwards.",
                    parameters: {
                      type: Type.OBJECT,
                      properties: {
                        fact: {
                          type: Type.STRING,
                          description: 'The fact, as one standalone sentence.'
                        }
                      },
                      required: ['fact']
                    }
                  },
                  {
                    name: 'recall',
                    description:
                      "Looks up what you already know about a topic. Use before saying you do not know something personal about the user.",
                    parameters: {
                      type: Type.OBJECT,
                      properties: {
                        query: { type: Type.STRING, description: 'What to look up.' }
                      },
                      required: ['query']
                    }
                  },
                  {
                    name: 'navigate_web',
                    description:
                      'Opens a specific website URL directly. If the user asks to search on a specific website (like YouTube, Amazon, etc.), construct the correct search URL (e.g., https://www.youtube.com/results?search_query=topic).',
                    parameters: {
                      type: Type.OBJECT,
                      properties: {
                        url: { type: Type.STRING, description: 'The full URL to open.' }
                      },
                      required: ['url']
                    }
                  },
                  ...[...COMPUTER_TOOLS, ...FILE_TOOLS].map(({ name, description, parameters }) => ({
                    name,
                    description,
                    parameters
                  })),
                  ...declarations
                ])
              }
            ],
            systemInstruction: { parts: [{ text: systemInstruction }] }
          }
        });

        sessionPromiseRef.current = sessionPromise;
        await sessionPromise;
      } catch (err: any) {
        console.error('Connection failed:', err);
        setError(err.message || 'Failed to connect');
        setMode('idle');
      }
    },
    [clearWakeTimer, commitTurn, enterStandby, exitStandby, log, scheduleWakeCheck]
  );
  connectRef.current = connect;

  const toggleStandby = useCallback(() => {
    if (isStandbyRef.current) exitStandby();
    else enterStandby();
  }, [enterStandby, exitStandby]);

  return {
    mode,
    isConnected,
    isStandby: mode === 'standby',
    isSpeaking,
    volume,
    error,
    agentActivity,
    apiUsage,
    connect,
    disconnect,
    /** Exposed so the settings panel can verify vision without a voice session. */
    describeScreen,
    enterStandby,
    exitStandby,
    toggleStandby,
    isMuted,
    setIsMuted,
    textOnly,
    setTextOnly
  };
}
