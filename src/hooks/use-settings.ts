import { useState, useEffect, useCallback } from 'react';
import type { LiveEngine } from '../lib/live-models';

export interface JarvisSettings {
  geminiKey: string;
  /**
   * The voice engine to start with: 'newest' (Gemini 3.8 Live), 'fast' (3.1
   * Flash Live) or 'classic' (2.5, liveModel). Each falls back to the next.
   */
  liveEngine: LiveEngine;
  /** The 2.5 engine's model. */
  liveModel: string;
  /** The 3.8 engine's model. Editable because Google renames models. */
  newestModel: string;
  voiceName: string;
  /** Text model used to distil memories from a finished conversation. */
  extractModel: string;
  /** Optional: enables mem0 cloud recall alongside the local store. */
  mem0Key: string;
  /** Optional: the city whose weather the HUD shows. Empty shows the time only. */
  homeCity: string;
}

export const DEFAULT_SETTINGS: JarvisSettings = {
  geminiKey: '',
  liveEngine: 'newest',
  // Model ids drift between releases, so these are only starting points and stay
  // editable. liveModel must be a native-audio Live model: it both hears and speaks.
  liveModel: 'gemini-2.5-flash-native-audio-preview-12-2025',
  newestModel: 'gemini-3.8-live',
  // Charon is the deepest of the prebuilt male voices, which suits the British
  // butler register the system prompt asks for.
  voiceName: 'Charon',
  // Tracks whatever the current flash model is, rather than pinning a version
  // that gets withdrawn under us: gemini-2.5-flash stopped serving new keys and
  // took memory extraction down with it.
  extractModel: 'gemini-3.5-flash',
  mem0Key: '',
  homeCity: ''
};

const STORAGE_KEY = 'jarvis.settings';

// Bump when the shape or the meaning of a field changes. Settings written by an
// older schema are discarded rather than merged, because a stale value can be
// worse than no value — an earlier build stored a text-only Live model here,
// which cannot speak and would fail at connect time. The API key is preserved
// across migrations since it stays valid and is tedious to re-enter.
const SCHEMA_VERSION = 2;

export function migrate(stored: any): JarvisSettings {
  if (!stored || typeof stored !== 'object') return DEFAULT_SETTINGS;

  if (stored.schemaVersion !== SCHEMA_VERSION) {
    return { ...DEFAULT_SETTINGS, geminiKey: typeof stored.geminiKey === 'string' ? stored.geminiKey : '' };
  }

  return {
    geminiKey: stored.geminiKey || '',
    // Absent or unknown means the user has not chosen: the newest engine.
    liveEngine: ['newest', 'fast', 'classic'].includes(stored.liveEngine) ? stored.liveEngine : 'newest',
    liveModel: stored.liveModel || DEFAULT_SETTINGS.liveModel,
    newestModel: typeof stored.newestModel === 'string' && stored.newestModel.trim() ? stored.newestModel.trim() : DEFAULT_SETTINGS.newestModel,
    // Fenrir was the old default and reads too light for the intended voice.
    // Anyone still on it is moved across; a deliberate choice is left alone.
    voiceName:
      !stored.voiceName || stored.voiceName === 'Fenrir'
        ? DEFAULT_SETTINGS.voiceName
        : stored.voiceName,
    // Same treatment as Fenrir above: gemini-2.5-flash was the old default and
    // now 404s for keys without prior access, so anyone still carrying it is
    // moved across. A different, deliberate choice is left alone.
    extractModel:
      !stored.extractModel || stored.extractModel === 'gemini-2.5-flash'
        ? DEFAULT_SETTINGS.extractModel
        : stored.extractModel,
    mem0Key: stored.mem0Key || '',
    homeCity: typeof stored.homeCity === 'string' ? stored.homeCity : ''
  };
}

// In Electron the preload bridge persists these through safeStorage (DPAPI on
// Windows). In a plain browser there is no such facility, so fall back to
// localStorage and accept that keys sit in plaintext there.
const bridge = () => (typeof window !== 'undefined' ? (window as any).jarvis : undefined);

async function loadSettings(): Promise<JarvisSettings> {
  const api = bridge();
  if (api?.loadSettings) {
    try {
      return migrate(await api.loadSettings());
    } catch (e) {
      console.error('Failed to load settings from secure store', e);
    }
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? migrate(JSON.parse(raw)) : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

async function persistSettings(settings: JarvisSettings): Promise<void> {
  const payload = { ...settings, schemaVersion: SCHEMA_VERSION };
  const api = bridge();
  if (api?.saveSettings) {
    await api.saveSettings(payload);
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

export function useSettings() {
  const [settings, setSettings] = useState<JarvisSettings>(DEFAULT_SETTINGS);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadSettings().then((loaded) => {
      if (!cancelled) {
        setSettings(loaded);
        setIsLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const save = useCallback(async (next: JarvisSettings) => {
    setSettings(next);
    await persistSettings(next);
  }, []);

  const isConfigured = Boolean(settings.geminiKey && settings.liveModel);

  return { settings, save, isLoaded, isConfigured };
}
