import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Mic, MicOff, X, Settings, Moon } from 'lucide-react';
import { useLiveApi } from '../hooks/use-live-api';
import { useHudData } from '../hooks/use-hud-data';
import { useSettings } from '../hooks/use-settings';
import { useChatHistory } from '../hooks/use-chat-history';
import { useMcp } from '../hooks/use-mcp';
import { useApis } from '../hooks/use-apis';
import { useMemory } from '../hooks/use-memory';
import { useShortcuts } from '../hooks/use-shortcuts';
import { useSkills } from '../hooks/use-skills';
import BrowserTab from './BrowserTab';
import SettingsPanel from './SettingsPanel';
import ChatTab from './ChatTab';
import McpTab from './McpTab';
import ApiTab from './ApiTab';
import MemoryTab from './MemoryTab';
import SkillsTab from './SkillsTab';
import ResearchTab from './ResearchTab';
import KeysTab from './KeysTab';

type Tab = 'HUD' | 'CHAT' | 'MCP' | 'API' | 'MEMORY' | 'BROWSER' | 'SKILLS' | 'RESEARCH' | 'KEYS';
const TABS: Tab[] = ['HUD', 'CHAT', 'MCP', 'API', 'MEMORY', 'BROWSER', 'SKILLS', 'RESEARCH', 'KEYS'];

export default function VoiceInterface() {
  const { settings, save, isConfigured } = useSettings();
  const { sessions, addMessage, flush, endSession } = useChatHistory();
  const chat = useMemo(() => ({ addMessage, flush, endSession }), [addMessage, flush, endSession]);

  const mem = useMemory(settings.mem0Key);
  const memory = useMemo(
    () => ({ brief: mem.brief, rememberFacts: mem.rememberFacts, recall: mem.recall }),
    [mem.brief, mem.rememberFacts, mem.recall]
  );

  const links = useShortcuts();
  const shortcuts = useMemo(
    () => ({ names: links.names, resolve: links.resolve }),
    [links.names, links.resolve]
  );

  const savedSkills = useSkills();
  const skills = useMemo(
    () => ({
      list: savedSkills.listForModel,
      resolve: savedSkills.resolve,
      markUsed: savedSkills.markUsed
    }),
    [savedSkills.listForModel, savedSkills.resolve, savedSkills.markUsed]
  );

  const { isConnected, isStandby, isSpeaking, volume, error, agentActivity, apiUsage, connect, disconnect, toggleStandby, describeScreen, isMuted, setIsMuted, setTextOnly } = useLiveApi(settings, chat, memory, shortcuts, skills);

  const { local, utc } = useHudData(settings.homeCity || '');

  const mcp = useMcp();
  const apis = useApis();

  // Linked services are remembered as pinned facts, so J.A.R.V.I.S. knows what
  // it can reach even before a tool is called.
  const { syncSystemMemories } = mem;
  useEffect(() => {
    const descriptions = [
      ...mcp.servers
        .filter((s) => s.status === 'connected')
        .map((s) => s.memory ?? `An MCP server called "${s.label}" is linked, providing ${s.tools.length} tools.`),
      ...apis.tools
        .filter((t) => t.enabled)
        .map((t) => {
          const provider = apis.providers.find((p) => p.id === t.provider);
          return `An API called "${t.name}" is connected${provider ? ` (${provider.label})` : ''}.`;
        })
    ];
    void syncSystemMemories(descriptions);
  }, [mcp.servers, apis.tools, apis.providers, syncSystemMemories]);

  const [showSettings, setShowSettings] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('HUD');
  const [researchId, setResearchId] = useState<string | null>(null);

  // A research JARVIS finished by voice: show it, as he says ("please check your screen").
  useEffect(() => {
    const show = (event: Event) => {
      const id = (event as CustomEvent<{ id: string }>).detail?.id;
      if (!id) return;
      setResearchId(id);
      setActiveTab('RESEARCH');
    };
    window.addEventListener('jarvis:research', show);
    return () => window.removeEventListener('jarvis:research', show);
  }, []);

  const handleToggle = () => {
    if (isConnected) {
      setIsMuted(!isMuted);
      if (isMuted) { // If it was muted and we are unmuting
        setTextOnly(false);
      }
    } else if (!isConfigured) {
      setActiveTab('KEYS');
    } else {
      connect();
    }
  };

  // Standby is a third visual state, distinct from muted: dimmed amber rather
  // than red, because the microphone is still listening.
  const isMutedColor = isStandby
    ? 'text-amber-400/70 shadow-amber-400'
    : isMuted
      ? 'text-red-500 shadow-red-500'
      : 'text-white shadow-white';
  const isMutedBorder = isStandby
    ? 'border-amber-400/40'
    : isMuted
      ? 'border-red-500'
      : 'border-white/50';
  const isMutedGlow = isStandby
    ? 'drop-shadow-[0_0_15px_rgba(251,191,36,0.5)]'
    : isMuted
      ? 'drop-shadow-[0_0_15px_rgba(239,68,68,0.8)]'
      : 'drop-shadow-[0_0_15px_rgba(255,255,255,0.5)]';

  return (
    <div className="relative min-h-screen bg-black flex flex-col items-center justify-between overflow-hidden font-mono selection:bg-white/20 text-[#e5e5e5]">

      {/* Background Gradient & Grid */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-[#111] via-black to-black opacity-80 pointer-events-none"></div>
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none"></div>

      {/* Circuit Board Corners (SVGs) */}
      <svg className="absolute top-0 left-0 w-64 h-64 opacity-20 text-white pointer-events-none" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="0.5">
         <path d="M 10,0 L 10,20 L 30,40 L 50,40 m -20,0 L 30,60 L 10,80 m 40,-40 L 70,20 L 100,20" />
         <circle cx="10" cy="20" r="2" fill="currentColor" />
         <circle cx="50" cy="40" r="2" fill="currentColor" />
         <circle cx="10" cy="80" r="2" fill="currentColor" />
         <circle cx="70" cy="20" r="2" fill="currentColor" />
         <path d="M 0,10 L 20,10 L 30,20 L 30,50" />
         <circle cx="30" cy="50" r="1.5" fill="currentColor" />
         <path d="M 80,0 L 80,10 L 90,20" />
         <circle cx="90" cy="20" r="1.5" fill="currentColor" />
      </svg>

      <svg className="absolute bottom-0 right-0 w-64 h-64 opacity-20 text-white pointer-events-none rotate-180" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="0.5">
         <path d="M 10,0 L 10,20 L 30,40 L 50,40 m -20,0 L 30,60 L 10,80 m 40,-40 L 70,20 L 100,20" />
         <circle cx="10" cy="20" r="2" fill="currentColor" />
         <circle cx="50" cy="40" r="2" fill="currentColor" />
         <circle cx="10" cy="80" r="2" fill="currentColor" />
         <circle cx="70" cy="20" r="2" fill="currentColor" />
         <path d="M 0,10 L 20,10 L 30,20 L 30,50" />
         <circle cx="30" cy="50" r="1.5" fill="currentColor" />
      </svg>

      <svg className="absolute top-0 right-0 w-48 h-48 opacity-10 text-white pointer-events-none rotate-90" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="0.5">
         <path d="M 10,0 L 10,20 L 30,40 L 50,40 m -20,0 L 30,60 L 10,80" />
         <circle cx="10" cy="20" r="2" fill="currentColor" />
         <circle cx="50" cy="40" r="2" fill="currentColor" />
      </svg>

      {/* Top Status Bar */}
      <div className="w-full flex justify-between items-center text-[10px] md:text-xs font-display px-6 pt-6 text-white/50 z-10 tracking-widest uppercase">
        <div className="flex items-center gap-6">
          <span>SYS.ON // J.A.R.V.I.S.</span>
          <div className="flex flex-wrap gap-4 border-l border-white/20 pl-6" role="tablist" aria-label="JARVIS sections">
            {TABS.map((tab) => (
              <button
                key={tab}
                role="tab"
                aria-selected={activeTab === tab}
                onClick={() => setActiveTab(tab)}
                className={`transition-colors ${activeTab === tab ? 'text-white border-b border-white' : 'hover:text-white/80'} ${
                  tab === 'KEYS' && !isConfigured ? 'text-amber-300/90' : ''
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className={`w-1.5 h-1.5 rounded-full ${isStandby ? 'bg-amber-400 animate-pulse drop-shadow-[0_0_5px_rgba(251,191,36,1)]' : isConnected ? 'bg-white animate-pulse drop-shadow-[0_0_5px_rgba(255,255,255,1)]' : 'bg-gray-600'}`}></div>
            <span className={isStandby ? 'text-amber-400/70' : undefined}>
              {isStandby ? 'DORMANT' : isConnected ? 'LINK_ESTABLISHED' : 'OFFLINE'}
            </span>
          </div>
          <button
            onClick={() => setShowSettings(true)}
            title="Configuration"
            className={`transition-colors ${isConfigured ? 'text-white/40 hover:text-white' : 'text-amber-400/80 hover:text-amber-300'}`}
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Left HUD Panel */}
      <div className={`absolute left-4 md:left-8 top-24 bottom-24 w-48 md:w-64 flex-col justify-between pointer-events-none z-20 ${activeTab === 'RESEARCH' ? 'hidden' : 'hidden lg:flex'}`}>
          {/* Local time, and the home city's weather */}
          <div className="border border-white/20 bg-black/50 backdrop-blur-sm p-4 rounded-lg shadow-[0_0_15px_rgba(255,255,255,0.05)]">
              <div className="text-[10px] text-white/70 tracking-widest mb-2 border-b border-white/20 pb-1 font-display">LOC // {local.label}</div>
              <div className="text-2xl text-white/90 font-light tracking-wider font-display">{local.time}</div>
              <div className="flex justify-between items-end mt-2 gap-2">
                  <div className="text-3xl text-white font-bold font-display">{local.temp}</div>
                  <div className="text-[10px] text-white/80 tracking-widest font-display text-right">{local.condition}</div>
              </div>
          </div>

          {/* Web Agent View (Activity Log) */}
          <div className="flex-1 my-4 border border-white/20 bg-black/50 backdrop-blur-sm p-4 rounded-lg shadow-[0_0_15px_rgba(255,255,255,0.05)] overflow-hidden flex flex-col">
              <div className="text-[10px] text-white/70 tracking-widest mb-2 border-b border-white/20 pb-1 font-display flex justify-between">
                  <span>SYS // AGENT_ACTIVITY</span>
                  <span className="animate-pulse text-white">●</span>
              </div>
              <div className="flex-1 overflow-y-auto font-mono text-[9px] text-white/60 space-y-2 pr-2 custom-scrollbar flex flex-col-reverse">
                  {agentActivity.slice().reverse().map((activity, i) => (
                      <div key={i} className="border-l-2 border-white/30 pl-2 py-1 bg-white/5">
                          <span className="text-white/40 mr-2">{`[${new Date().toLocaleTimeString([], {hour12: false, hour: '2-digit', minute:'2-digit', second:'2-digit'})}]`}</span>
                          {activity}
                      </div>
                  ))}
                  {agentActivity.length === 0 && (
                      <div className="text-white/30 italic">Awaiting tasks...</div>
                  )}
              </div>
          </div>

          {/* UTC */}
          <div className="border border-white/20 bg-black/50 backdrop-blur-sm p-4 rounded-lg shadow-[0_0_15px_rgba(255,255,255,0.05)]">
              <div className="text-[10px] text-white/70 tracking-widest mb-2 border-b border-white/20 pb-1 font-display">LOC // {utc.label}</div>
              <div className="text-2xl text-white/90 font-light tracking-wider font-display">{utc.time}</div>
              <div className="text-[10px] text-white/60 tracking-widest font-display mt-2">{utc.condition}</div>
          </div>
      </div>

      {/* Right HUD Panel */}
      <div className={`absolute right-4 md:right-8 top-24 bottom-24 w-48 md:w-64 flex-col justify-between pointer-events-none z-20 ${activeTab === 'RESEARCH' ? 'hidden' : 'hidden lg:flex'}`}>
          {/* System Status */}
          <div className="border border-white/20 bg-black/50 backdrop-blur-sm p-4 rounded-lg shadow-[0_0_15px_rgba(255,255,255,0.05)]">
              <div className="text-[10px] text-white/70 tracking-widest mb-2 border-b border-white/20 pb-1 font-display">SYS // DIAGNOSTICS</div>
              <div className="space-y-3 mt-3">
                  <div>
                      <div className="flex justify-between text-[8px] text-white/80 mb-1 font-mono">
                          <span>API_REQUESTS</span>
                          <span>{apiUsage.requests}</span>
                      </div>
                      <div className="w-full h-1 bg-gray-900 rounded-full overflow-hidden">
                          <motion.div 
                              animate={{ width: isConnected ? ['40%', '45%', '42%'] : '12%' }} 
                              transition={{ duration: 2, repeat: Infinity }}
                              className="h-full bg-white/80"
                          />
                      </div>
                  </div>
                  <div>
                      <div className="flex justify-between text-[8px] text-white/80 mb-1 font-mono">
                          <span>TOOLS_INVOKED</span>
                          <span>{apiUsage.toolsUsed}</span>
                      </div>
                      <div className="w-full h-1 bg-gray-900 rounded-full overflow-hidden">
                          <motion.div 
                              animate={{ width: isConnected ? ['60%', '62%', '60%'] : '20%' }} 
                              transition={{ duration: 3, repeat: Infinity }}
                              className="h-full bg-white/60"
                          />
                      </div>
                  </div>
                  <div>
                      <div className="flex justify-between text-[8px] text-white/80 mb-1 font-mono">
                          <span>NET_LATENCY</span>
                          <span>{isConnected ? '24ms' : '--'}</span>
                      </div>
                      <div className="w-full h-1 bg-gray-900 rounded-full overflow-hidden">
                          <div className={`h-full ${isConnected ? 'w-[15%] bg-white/40' : 'w-0'}`} />
                      </div>
                  </div>
              </div>
          </div>

          {/* Security Protocol */}
          <div className="border border-white/20 bg-black/50 backdrop-blur-sm p-4 rounded-lg shadow-[0_0_15px_rgba(255,255,255,0.05)] mt-4">
              <div className="text-[10px] text-white/70 tracking-widest mb-2 border-b border-white/20 pb-1 font-display">SYS // SECURITY</div>
              <div className="space-y-2 mt-2">
                  <div className="flex justify-between text-[9px] font-mono text-white/80">
                      <span>FIREWALL</span>
                      <span className="text-emerald-400">ACTIVE</span>
                  </div>
                  <div className="flex justify-between text-[9px] font-mono text-white/80">
                      <span>KEYS</span>
                      <span className={isConfigured ? 'text-emerald-400' : 'text-amber-400'}>{isConfigured ? 'LOCAL ONLY' : 'NEEDED'}</span>
                  </div>
                  <div className="flex justify-between text-[9px] font-mono text-white/80">
                      <span>THREAT_LEVEL</span>
                      <span className="text-cyan-400">MINIMAL</span>
                  </div>
                  <div className="flex justify-between text-[9px] font-mono text-white/80">
                      <span>SCREEN_VISION</span>
                      <span className="text-emerald-400">READY</span>
                  </div>
              </div>
          </div>

          {/* Memory Core */}
          <div className="border border-white/20 bg-black/50 backdrop-blur-sm p-4 rounded-lg shadow-[0_0_15px_rgba(255,255,255,0.05)] mt-4">
              <div className="text-[10px] text-white/70 tracking-widest mb-2 border-b border-white/20 pb-1 font-display">SYS // MEMORY CORE</div>
              <div className="mt-2 flex items-center justify-center gap-2">
                  {[...Array(8)].map((_, i) => (
                      <motion.div 
                          key={i}
                          animate={{ height: isConnected ? ['10px', '24px', '10px'] : '10px' }}
                          transition={{ duration: 1.5, repeat: Infinity, delay: i * 0.1 }}
                          className="w-2 bg-white/40 rounded-sm"
                      />
                  ))}
              </div>
              <div className="mt-3 text-[8px] text-center text-white/50 font-mono">
                  ALLOCATION: {isConnected ? 'OPTIMAL' : 'STANDBY'}
              </div>
          </div>

      </div>

      {/* Main Visualizer Area */}
      <div className="flex-1 flex items-center justify-center w-full relative z-10">
        
        {activeTab === 'HUD' ? (
          <div className="relative flex items-center justify-center w-[300px] h-[300px] md:w-[450px] md:h-[450px]">
            
            {/* Outer dashed ring */}
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 30, repeat: Infinity, ease: "linear" }}
              className={`absolute inset-0 rounded-full border-[1px] border-dashed ${isMutedBorder} opacity-20`}
            />

            {/* Middle ring with volume pulse */}
            <motion.div
              animate={{
                scale: isConnected && !isMuted ? 1 + volume * 0.3 : 1,
                rotate: -360
              }}
              transition={{
                scale: { type: "spring", stiffness: 300, damping: 20 },
                rotate: { duration: 40, repeat: Infinity, ease: "linear" }
              }}
              className={`absolute inset-4 md:inset-8 rounded-full border-[2px] ${isMutedBorder} opacity-40 border-t-transparent border-b-transparent`}
            />

            {/* Inner solid ring */}
            <motion.div
              animate={{
                scale: isConnected && !isMuted ? 1 + volume * 0.1 : 1,
              }}
              className={`absolute inset-10 md:inset-16 rounded-full border-[1px] ${isMutedBorder} opacity-60`}
              style={{ boxShadow: `0 0 30px ${isStandby ? 'rgba(251,191,36,0.25)' : isMuted ? 'rgba(239,68,68,0.2)' : 'rgba(34,211,238,0.2)'} inset` }}
            />

            {/* Globe Grid (CSS trick) */}
            <div className="absolute inset-12 md:inset-20 rounded-full overflow-hidden opacity-10 pointer-events-none">
               <div className="w-full h-full border-[1px] border-white/50 rounded-[50%] absolute top-0 left-0 scale-x-50"></div>
               <div className="w-full h-full border-[1px] border-white/50 rounded-[50%] absolute top-0 left-0 scale-x-75"></div>
               <div className="w-full h-full border-[1px] border-white/50 rounded-[50%] absolute top-0 left-0"></div>
               <div className="w-full h-full border-[1px] border-white/50 rounded-[50%] absolute top-0 left-0 scale-y-50"></div>
               <div className="w-full h-full border-[1px] border-white/50 rounded-[50%] absolute top-0 left-0 scale-y-75"></div>
            </div>

            {/* Center Text */}
            <div className={`z-10 text-2xl md:text-4xl font-bold tracking-[0.4em] ${isMutedColor} ${isMutedGlow} uppercase transition-all duration-300 font-display`}>
              J.A.R.V.I.S
            </div>

            {/* Speaking Indicator (Flux Effect) */}
            {isSpeaking && (
               <>
                 <motion.div
                   animate={{ 
                     scale: [1, 1.15, 1],
                     opacity: [0.2, 0.6, 0.2],
                     rotate: [0, 180, 360]
                   }}
                   transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                   className="absolute inset-0 rounded-full border-[3px] border-cyan-400/40 blur-[2px] mix-blend-screen pointer-events-none"
                   style={{ filter: 'drop-shadow(0 0 15px rgba(34,211,238,0.6))' }}
                 />
                 <motion.div
                   animate={{ 
                     scale: [1.1, 1.25, 1.1],
                     opacity: [0.1, 0.4, 0.1],
                     rotate: [360, 180, 0]
                   }}
                   transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                   className="absolute -inset-4 rounded-full border-[2px] border-cyan-300/30 blur-md mix-blend-screen pointer-events-none"
                 />
                 <motion.div
                   animate={{ opacity: [0.2, 0.5, 0.2], scale: [0.9, 1.1, 0.9] }}
                   transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                   className="absolute inset-16 rounded-full bg-cyan-500/20 blur-2xl pointer-events-none"
                 />
               </>
            )}
          </div>
        ) : activeTab === 'CHAT' ? (
          <ChatTab sessions={sessions} />
        ) : activeTab === 'MCP' ? (
          <McpTab
            servers={mcp.servers}
            toolCount={mcp.toolCount}
            onAdd={mcp.addServer}
            onRemove={mcp.removeServer}
            onReconnect={mcp.reconnect}
            onSetEnabled={mcp.setEnabled}
            onRename={mcp.renameServer}
          />
        ) : activeTab === 'API' ? (
          <ApiTab
            tools={apis.tools}
            providers={apis.providers}
            enabledCount={apis.enabledCount}
            onSave={apis.saveTool}
            onRemove={apis.removeTool}
            onSetEnabled={apis.setEnabled}
            onTest={apis.testTool}
          />
        ) : activeTab === 'MEMORY' ? (
          <MemoryTab
            memories={mem.memories}
            starredCount={mem.starredCount}
            onAdd={mem.addMemory}
            onUpdate={mem.updateMemory}
            onToggleStar={mem.toggleStar}
            onRemove={mem.removeMemory}
          />
        ) : activeTab === 'SKILLS' ? (
          <SkillsTab
            skills={savedSkills.skills}
            enabledCount={savedSkills.enabledCount}
            onSave={savedSkills.saveSkill}
            onRemove={savedSkills.removeSkill}
            onSetEnabled={savedSkills.setEnabled}
          />
        ) : activeTab === 'RESEARCH' ? (
          <ResearchTab geminiKey={settings.geminiKey} openId={researchId} />
        ) : activeTab === 'KEYS' ? (
          <KeysTab
            settings={settings}
            onSave={save}
            apiTools={apis.tools}
            apiProviders={apis.providers}
            onSaveApiTool={apis.saveTool}
          />
        ) : (
          <BrowserTab
            shortcuts={links.shortcuts}
            onSave={links.saveShortcut}
            onRemove={links.removeShortcut}
          />
        )}
      </div>

      {/* Bottom Controls */}
      <div className="w-full max-w-md flex flex-col items-center justify-center px-8 pb-12 z-10">
        
        {/* Center Text Status */}
        <div className="text-center mb-8 h-6">
            {error ? (
                <p className="text-xs text-red-500 font-medium tracking-widest uppercase font-display">{error}</p>
            ) : (
                <p className={`text-xs font-medium tracking-widest uppercase font-display ${isStandby ? 'text-amber-400/70' : isConnected ? 'text-white/70' : 'text-gray-500'}`}>
                    {isStandby
                        ? 'DORMANT // AWAITING "HEY JARVIS"'
                        : isConnected
                            ? (isMuted
                                ? "AUDIO_INPUT_DISABLED"
                                : (isSpeaking ? "TRANSMITTING..." : "AWAITING_INPUT..."))
                            : "SYSTEM_STANDBY"
                    }
                </p>
            )}
        </div>

        <div className="flex items-center justify-center gap-8 mb-6">
            {/* Mic Button */}
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={handleToggle}
              className={`
                w-16 h-16 rounded-full flex items-center justify-center transition-all duration-300 border
                ${isConnected 
                    ? (isMuted 
                        ? 'bg-red-950/50 border-red-500 text-red-500 shadow-[0_0_15px_rgba(239,68,68,0.3)]' 
                        : 'bg-white/10 border-white/50 text-white shadow-[0_0_15px_rgba(255,255,255,0.2)]') 
                    : 'bg-black border-gray-700 text-gray-500 hover:border-white/50 hover:text-white/80'}
              `}
            >
              {isConnected && isMuted ? (
                <MicOff className="w-6 h-6" />
              ) : (
                <Mic className="w-6 h-6" />
              )}
            </motion.button>

            {/* Standby Toggle */}
            {isConnected && (
                <motion.button
                  initial={{ opacity: 0, scale: 0 }}
                  animate={{ opacity: 1, scale: 1 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={toggleStandby}
                  title={isStandby ? 'Wake J.A.R.V.I.S.' : 'Enter standby — only "Hey Jarvis" is heard'}
                  className={`w-12 h-12 rounded-full border flex items-center justify-center transition-all duration-300 ${
                    isStandby
                      ? 'bg-amber-950/40 border-amber-400/60 text-amber-400 shadow-[0_0_15px_rgba(251,191,36,0.25)]'
                      : 'bg-black border-gray-700 text-gray-400 hover:border-amber-400/50 hover:text-amber-400/80'
                  }`}
                >
                  <Moon className="w-5 h-5" />
                </motion.button>
            )}

            {/* Close Button */}
            {isConnected && (
                <motion.button
                  initial={{ opacity: 0, scale: 0 }}
                  animate={{ opacity: 1, scale: 1 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={disconnect}
                  className="w-12 h-12 rounded-full bg-black border border-gray-700 flex items-center justify-center text-gray-400 hover:border-red-500/50 hover:text-red-500 transition-all duration-300"
                >
                  <X className="w-5 h-5" />
                </motion.button>
            )}
        </div>

      </div>

      {/*
        Rendered plainly rather than wrapped in AnimatePresence.
        AnimatePresence does not remove its child here — the exit animation
        runs to opacity 0 but the element stays mounted, and since this is a
        full-screen fixed overlay, the invisible leftover went on swallowing
        every click in the window: closing the settings panel used to leave the
        whole interface unresponsive. Plain conditional rendering unmounts
        immediately; the cost is the fade-out, which nobody was watching anyway.
      */}
      {showSettings && (
        <SettingsPanel
          settings={settings}
          onSave={save}
          onTestVision={describeScreen}
          onOpenKeys={() => {
            setShowSettings(false);
            setActiveTab('KEYS');
          }}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
