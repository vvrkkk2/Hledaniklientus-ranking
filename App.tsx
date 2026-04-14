import React, { useState, useEffect, useRef } from 'react';
import { Rocket, Sparkles, Play, RefreshCw, Trash2, PlusCircle, Settings, PauseCircle, ZapOff, WifiOff, Wifi } from 'lucide-react';
import InputSection from './components/InputSection';
import SmartResultsTable from './components/SmartResultsTable';
import { ScanResult, ScanStatus, InputItem, Segment, AppSettings } from './types';
import { analyzeSegments, processContact, classifyRow } from './services/geminiService';
import { saveResultsToDB, saveSegmentsToDB, saveSettingsToDB, loadSegmentsAndSettings, clearDB, syncRowToSheet, upsertResult, getStats, getNextPendingItem } from './services/storageService';

// Simplified Steps
type AppStep = 'UPLOAD' | 'RESULTS';

// Vaše vygenerovaná URL pro Google Sheets
const DEFAULT_SHEET_URL = "https://script.google.com/macros/s/AKfycbwhzl9fx8nXCwYMQsHTzIXMnTtMNSSfZecz9yE-VMunlaLw6lpUHIiJmMEw7p_tCumQ2Q/exec";

const App: React.FC = () => {
  // --- STATE ---
  const [step, setStep] = useState<AppStep>('UPLOAD');
  // MEMORY FIX: We no longer store `results` array in state. It kills the browser at 20k items.
  // We only store summary stats and the SmartTable fetches its own page data.
  const [stats, setStats] = useState({ total: 0, completed: 0, failed: 0, pending: 0 });
  const [lastTableUpdate, setLastTableUpdate] = useState(0); // Trigger to refresh table view
  
  const [segments, setSegments] = useState<Segment[]>([]);
  
  const [settings, setSettings] = useState<AppSettings>({ 
      autoSync: true, 
      googleSheetUrl: DEFAULT_SHEET_URL,
      searchEmails: true
  });
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [isCoolingDown, setIsCoolingDown] = useState(false);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isTestingSync, setIsTestingSync] = useState(false);
  
  const [confirmDialog, setConfirmDialog] = useState<{ isOpen: boolean, message: string, onConfirm: () => void } | null>(null);
  const [alertDialog, setAlertDialog] = useState<{ isOpen: boolean, message: string } | null>(null);
  
  const processingRef = useRef<boolean>(false);

  // --- NETWORK GUARDIAN ---
  useEffect(() => {
    const handleOnline = () => {
        setIsOffline(false);
        // Auto-resume if we were processing
        if (processingRef.current === false && stats.pending > 0 && step === 'RESULTS') {
             console.log("Network recovered, auto-resuming...");
             handleResume(); 
        }
    };
    const handleOffline = () => {
        setIsOffline(true);
        // Loop will pause naturally due to checks
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
    };
  }, [stats.pending, step]);

  // --- INITIAL LOAD ---
  useEffect(() => {
    const init = async () => {
      try {
        const { segments: dbSegments, settings: dbSettings } = await loadSegmentsAndSettings();
        setSegments(dbSegments);
        
        const loadedSettings: AppSettings = {
            autoSync: dbSettings.autoSync ?? true,
            googleSheetUrl: dbSettings.googleSheetUrl || DEFAULT_SHEET_URL,
            idealClientProfile: dbSettings.idealClientProfile,
            serviceDescription: dbSettings.serviceDescription,
            searchEmails: dbSettings.searchEmails ?? true
        };
        setSettings(loadedSettings);
        
        // Check if we have data
        const currentStats = await getStats();
        setStats(currentStats);
        
        if (currentStats.total > 0) {
            setStep('RESULTS');
        }
      } catch (e) {
        console.error("Failed to load DB", e);
      } finally {
        setIsLoaded(true);
      }
    };
    init();
  }, []);

  useEffect(() => {
      if(isLoaded) {
          saveSettingsToDB(settings);
      }
  }, [settings, isLoaded]);

  // --- ACTIONS ---

  const handleReset = (skipConfirm: boolean = false) => {
    if (isProcessing) {
        setConfirmDialog({
            isOpen: true,
            message: "Proces stále běží. Opravdu chcete skončit a zahodit výsledky?",
            onConfirm: () => {
                setConfirmDialog(null);
                performReset();
            }
        });
        return;
    } else if (!skipConfirm && stats.total > 0) {
        setConfirmDialog({
            isOpen: true,
            message: "Tímto smažete aktuální výsledky a začnete nové hledání. Pokračovat?",
            onConfirm: () => {
                setConfirmDialog(null);
                performReset();
            }
        });
        return;
    }

    performReset();
  };

  const performReset = async () => {
      processingRef.current = false; // Kill loop
      setStats({ total: 0, completed: 0, failed: 0, pending: 0 });
      setSegments([]);
      setStep('UPLOAD');
      setIsProcessing(false);
      setError(null);
      await clearDB();
  };

  const handleTestSync = async () => {
      if (!settings.googleSheetUrl) return;
      setIsTestingSync(true);
      
      const dummyResult: ScanResult = {
          id: 'test-id',
          url: 'https://test-example.com',
          status: ScanStatus.COMPLETED,
          enrichedData: {
              email: 'jan@test.cz',
              personName: 'Jan Testovací',
              firstName: 'Jan',
              lastName: 'Testovací',
              personRole: 'Majitel',
              salutation: 'Vážený pane Testovací',
              companyContext: 'Toto je testovací řádek pro ověření spojení.',
              ico: '12345678',
              language: 'cs',
              contactType: 'person'
          }
      };

      await syncRowToSheet(dummyResult, 'Test Segment', settings.googleSheetUrl);
      setAlertDialog({ isOpen: true, message: "Odesláno! Zkontrolujte nyní vaši Google Tabulku." });
      setIsTestingSync(false);
  };

  const handleStart = async (items: InputItem[]) => {
    setError(null);
    setIsProcessing(true);
    setStep('RESULTS');

    try {
        const initialResults: ScanResult[] = items.map(item => ({
            id: crypto.randomUUID(),
            url: item.url,
            status: ScanStatus.PENDING,
            retryCount: 0, // Init retry count
            originalRow: item.originalRow
        }));
        
        // Save initial state to DB
        await saveResultsToDB(initialResults);
        
        // Update stats
        const currentStats = await getStats();
        setStats(currentStats);
        setLastTableUpdate(Date.now());

        const generatedSegments = await analyzeSegments(items.map(i => i.originalRow || {}));
        setSegments(generatedSegments);
        await saveSegmentsToDB(generatedSegments);
        
        await processQueueLoop(generatedSegments);

    } catch (e) {
        setError("Chyba při inicializaci: " + (e instanceof Error ? e.message : String(e)));
        setIsProcessing(false);
    }
  };

  const handleResume = async () => {
    setError(null);
    setIsProcessing(true);
    await processQueueLoop(segments);
  };

  const handleRetryRow = async (id: string) => {
      // Stub for future functionality or single item retry logic
      setAlertDialog({ isOpen: true, message: "Funkce Retry pro jednotlivé řádky bude dostupná v příští verzi pro optimalizovaný režim." });
  };

  // --- CORE PROCESSING LOOP (ROBUST MODE) ---
  const processQueueLoop = async (contextSegments: Segment[]) => {
      if (processingRef.current) return; // Prevent double loop
      processingRef.current = true;
      
      // ADAPTIVE THROTTLING VARIABLES
      let currentDelay = 1000; // Sníženo z 3000 na 1000
      const MAX_DELAY = 5000;  // Sníženo z 15000 na 5000
      
      const refreshStats = async () => {
          const s = await getStats();
          setStats(s);
          setLastTableUpdate(Date.now());
      };

      try {
        while (processingRef.current) {
            // 0. CHECK NETWORK
            if (!navigator.onLine) {
                setIsOffline(true);
                // Wait for online loop
                while (!navigator.onLine && processingRef.current) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
                setIsOffline(false);
                if (!processingRef.current) break; // If stopped during offline
            }

            // 1. FETCH SINGLE ITEM FROM DB (Not Array Pop)
            const item = await getNextPendingItem();
            
            if (!item) {
                // No more items pending
                break;
            }

            // 2. Mark Processing
            await upsertResult({ ...item, status: ScanStatus.PROCESSING });
            
            // 3. Process
            const segmentId = await classifyRow(item.originalRow || {}, contextSegments);
            const segment = contextSegments.find(s => s.id === segmentId) || contextSegments[0] || { id: 'def', name: 'Obecné', description: 'Obecný segment' };

            try {
                const enriched = await processContact(item.url, item.originalRow, segment, settings.idealClientProfile, settings.serviceDescription, settings.searchEmails !== false);

                let completedResult: ScanResult = { 
                    ...item,
                    status: ScanStatus.COMPLETED,
                    segmentId: segment.id,
                    enrichedData: enriched,
                    syncedToSheets: false
                };

                if (settings.autoSync && settings.googleSheetUrl) {
                    try {
                        const synced = await syncRowToSheet(completedResult, segment.name, settings.googleSheetUrl);
                        completedResult.syncedToSheets = synced;
                    } catch (syncErr) {
                         console.warn("Sync failed, but processing continues", syncErr);
                         // Don't fail the item just because sheets sync failed
                    }
                }

                await upsertResult(completedResult);
                
                // Success reduces delay slowly
                if (currentDelay > 1000) {
                    currentDelay = Math.max(1000, currentDelay - 500); 
                }

            } catch (err: any) {
                let errorMessage = err.message || String(err);
                
                // CRITICAL ERROR (503/429) -> PAUSE EVERYONE
                if (errorMessage.includes('503') || errorMessage.includes('429') || errorMessage.includes('overloaded') || errorMessage.includes('resource exhausted')) {
                    setIsCoolingDown(true);
                    await new Promise(resolve => setTimeout(resolve, 60000)); // 60s hard penalty
                    setIsCoolingDown(false);
                    currentDelay = Math.min(MAX_DELAY, currentDelay + 3000);
                    
                    // Soft Retry: Put back to PENDING (don't count as retry for rate limits)
                    await upsertResult({ ...item, status: ScanStatus.PENDING }); 
                    
                } 
                // NETWORK ERROR (Fetch failed) -> PAUSE & RETRY
                else if (errorMessage.includes('fetch failed') || errorMessage.includes('NetworkError') || errorMessage.includes('Failed to fetch')) {
                     console.warn("Network error detected, waiting...");
                     setIsOffline(true);
                     await new Promise(resolve => setTimeout(resolve, 5000));
                     // Return to queue
                     await upsertResult({ ...item, status: ScanStatus.PENDING });
                }
                // LOGIC/TIMEOUT ERROR -> SOFT RETRY OR FAIL
                else {
                    const currentRetries = item.retryCount || 0;
                    if (currentRetries < 3) {
                        // Soft Fail - Return to queue with incremented count
                        console.warn(`Item ${item.url} failed (Attempt ${currentRetries + 1}/3). Retrying later.`);
                        await upsertResult({ 
                            ...item, 
                            status: ScanStatus.PENDING, 
                            retryCount: currentRetries + 1,
                            error: `Pokus ${currentRetries + 1}: ${errorMessage}` // Log partial error
                        });
                        // Wait a bit to avoid hammer
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    } else {
                        // Hard Fail
                        const failedResult = { ...item, status: ScanStatus.FAILED, error: errorMessage };
                        await upsertResult(failedResult);
                    }
                }
            }

            // 4. Refresh UI Stats (throttled)
            await refreshStats();

            // 5. Wait
            if (processingRef.current) {
                await new Promise(resolve => setTimeout(resolve, currentDelay));
            }
        }
      } catch (e) {
          console.error("Queue error", e);
      } finally {
          processingRef.current = false;
          setIsProcessing(false);
          setIsCoolingDown(false);
          setIsOffline(false);
          await refreshStats();
      }
  };

  if (!isLoaded) return <div className="min-h-screen flex items-center justify-center text-slate-400">Načítám databázi...</div>;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-20 font-sans">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-600/20">
              <Rocket className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-xl tracking-tight text-slate-900">AI Smart Outreach</h1>
              <p className="text-xs text-slate-500 font-medium">Automatizovaný obchodní asistent</p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <button 
                onClick={() => setShowSettings(true)}
                className={`p-2 rounded-lg transition-colors ${settings.autoSync ? 'bg-green-50 text-green-700 border border-green-200' : 'hover:bg-slate-100 text-slate-500'}`}
                title="Nastavení synchronizace"
            >
                <Settings className="w-5 h-5" />
            </button>

            {stats.total > 0 && (
                <button 
                    onClick={() => handleReset(false)}
                    className="flex items-center gap-2 text-slate-500 hover:text-red-600 text-sm font-medium transition-colors"
                >
                    <Trash2 className="w-4 h-4" />
                    <span className="hidden sm:inline">Reset</span>
                </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-4 py-8">
        
        {/* Settings Modal */}
        {showSettings && (
            <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
                <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full p-6">
                    <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                        <Settings className="w-5 h-5 text-indigo-600" />
                        Nastavení
                    </h3>
                    
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Google Sheets Script URL</label>
                            <div className="flex gap-2">
                                <input 
                                    type="text" 
                                    className="w-full p-2 border border-slate-300 rounded focus:ring-2 focus:ring-indigo-500 outline-none text-sm font-mono text-slate-500"
                                    value={settings.googleSheetUrl || ''}
                                    onChange={(e) => setSettings(s => ({...s, googleSheetUrl: e.target.value}))}
                                />
                                <button 
                                    onClick={handleTestSync}
                                    disabled={isTestingSync || !settings.googleSheetUrl}
                                    className="px-3 py-2 bg-indigo-50 text-indigo-700 rounded border border-indigo-200 hover:bg-indigo-100 disabled:opacity-50 text-sm font-medium whitespace-nowrap flex items-center gap-2"
                                >
                                    {isTestingSync ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                                    Test
                                </button>
                            </div>
                        </div>

                        <div className="flex items-center gap-3">
                            <input 
                                type="checkbox" 
                                id="autoSync"
                                className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500"
                                checked={settings.autoSync}
                                onChange={(e) => setSettings(s => ({...s, autoSync: e.target.checked}))}
                            />
                            <label htmlFor="autoSync" className="text-sm font-medium text-slate-700">Povolit automatickou synchronizaci</label>
                        </div>
                    </div>

                    <div className="mt-6 flex justify-end gap-3">
                        <button onClick={() => setShowSettings(false)} className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">Uložit</button>
                    </div>
                </div>
            </div>
        )}

        {/* Global Error/Warning Display */}
        {error && !isCoolingDown && !isOffline && (
             <div className="mb-6 bg-orange-50 border border-orange-200 rounded-lg p-4 flex items-start gap-3 text-orange-800 animate-in fade-in">
                 <PauseCircle className="w-5 h-5 shrink-0 mt-0.5" />
                 <div>
                     <h4 className="font-semibold text-sm">Chyba procesu</h4>
                     <p className="text-sm opacity-90">{error}</p>
                 </div>
             </div>
        )}

        {/* STEP 1: UPLOAD */}
        {step === 'UPLOAD' && (
            <div className="animate-in fade-in zoom-in-95 duration-300">
                <InputSection 
                    onStart={handleStart} 
                    isProcessing={isProcessing} 
                    settings={settings} 
                    onSettingsChange={setSettings} 
                    onAlert={(msg) => setAlertDialog({ isOpen: true, message: msg })}
                />
            </div>
        )}

        {/* STEP 2: RESULTS */}
        {step === 'RESULTS' && (
            <div className="space-y-6">
                {/* Status Bar */}
                <div className="flex flex-col md:flex-row gap-4 items-center justify-between bg-white p-4 rounded-xl border border-slate-200 shadow-sm transition-all duration-300">
                    
                    {/* STATUS: OFFLINE */}
                    {isOffline ? (
                        <div className="flex items-center gap-3 text-red-600 w-full animate-pulse">
                            <WifiOff className="w-6 h-6" />
                            <div>
                                <span className="font-bold">Ztráta připojení</span>
                                <p className="text-xs mt-0.5">Čekám na obnovení internetu. Nezavírejte okno.</p>
                            </div>
                        </div>
                    ) : 
                    /* STATUS: API OVERLOAD (503) */
                    isCoolingDown ? (
                         <div className="flex items-center gap-3 text-red-700 w-full animate-pulse">
                            <ZapOff className="w-6 h-6" />
                            <div>
                                <span className="font-bold">API přetíženo - Vynucená pauza 60s</span>
                                <p className="text-xs mt-0.5">Čekám na obnovení limitů Google Gemini...</p>
                            </div>
                         </div>
                    ) : 
                    /* STATUS: PROCESSING */
                    isProcessing ? (
                         <div className="flex items-center gap-3 text-indigo-700">
                            <div className="relative">
                                <Sparkles className="w-6 h-6 animate-pulse" />
                                <div className="absolute inset-0 bg-indigo-400 blur-lg opacity-30 animate-pulse"></div>
                            </div>
                            <div>
                                <span className="font-bold">AI pracuje...</span>
                                <p className="text-xs text-slate-500 mt-0.5">Robustní režim (Auto-reconnect aktivní)</p>
                            </div>
                         </div>
                    ) : 
                    /* STATUS: PAUSED/PENDING */
                    stats.pending > 0 ? (
                        <div className="flex items-center gap-3 text-orange-700">
                            <PauseCircle className="w-5 h-5" />
                            <div>
                                <span className="font-bold">Pozastaveno</span>
                                <p className="text-xs text-slate-600 mt-0.5">Zbývá {stats.pending} položek.</p>
                            </div>
                        </div>
                    ) : (
                        /* STATUS: DONE */
                        <div className="flex items-center gap-3 text-emerald-700">
                            <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center">
                                <Play className="w-4 h-4 fill-emerald-700" />
                            </div>
                            <div>
                                <span className="font-bold">Hotovo!</span>
                            </div>
                        </div>
                    )}

                    {!isProcessing && stats.pending > 0 && !isOffline && (
                        <button 
                            onClick={handleResume}
                            className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700 transition-all"
                        >
                            <RefreshCw className="w-4 h-4" />
                            Pokračovat ve hledání
                        </button>
                    )}
                    
                    {!isProcessing && stats.pending === 0 && (
                         <button 
                            onClick={() => handleReset(true)} 
                            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700"
                        >
                            <PlusCircle className="w-4 h-4" />
                            Nahrát další
                        </button>
                    )}
                </div>

                <SmartResultsTable 
                    totalCount={stats.total}
                    completedCount={stats.completed + stats.failed}
                    segments={segments} 
                    onRetry={handleRetryRow}
                    lastUpdated={lastTableUpdate}
                    onAlert={(msg) => setAlertDialog({ isOpen: true, message: msg })}
                />
            </div>
        )}

      </main>

      {/* Confirm Modal */}
      {confirmDialog?.isOpen && (
          <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
              <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full p-6">
                  <h3 className="text-lg font-bold text-slate-900 mb-2">Opravdu?</h3>
                  <p className="text-slate-600 mb-6">{confirmDialog.message}</p>
                  <div className="flex justify-end gap-3">
                      <button 
                          onClick={() => setConfirmDialog(null)} 
                          className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium transition-colors"
                      >
                          Zrušit
                      </button>
                      <button 
                          onClick={confirmDialog.onConfirm} 
                          className="px-4 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 transition-colors shadow-sm"
                      >
                          Potvrdit
                      </button>
                  </div>
              </div>
          </div>
      )}

      {/* Alert Modal */}
      {alertDialog?.isOpen && (
          <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
              <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full p-6">
                  <h3 className="text-lg font-bold text-slate-900 mb-2">Oznámení</h3>
                  <p className="text-slate-600 mb-6">{alertDialog.message}</p>
                  <div className="flex justify-end">
                      <button 
                          onClick={() => setAlertDialog(null)} 
                          className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors shadow-sm"
                      >
                          Rozumím
                      </button>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};

export default App;