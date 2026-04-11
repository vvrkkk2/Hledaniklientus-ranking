import { ScanResult, Segment, AppSettings, ScanStatus } from '../types';

const DB_NAME = 'AISmartOutreachDB';
const DB_VERSION = 1;

const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains('results')) {
        db.createObjectStore('results', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('segments')) {
        db.createObjectStore('segments', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };
  });
};

// --- EFFICIENT READ METHODS ---

export const getStats = async () => {
    const db = await openDB();
    return new Promise<{ total: number, completed: number, failed: number, pending: number }>((resolve) => {
        const tx = db.transaction('results', 'readonly');
        const store = tx.objectStore('results');
        const request = store.getAll(); 
        
        request.onsuccess = () => {
            const all = request.result as ScanResult[];
            const stats = {
                total: all.length,
                completed: 0,
                failed: 0,
                pending: 0
            };
            for(const item of all) {
                if (item.status === ScanStatus.COMPLETED) stats.completed++;
                else if (item.status === ScanStatus.FAILED) stats.failed++;
                else stats.pending++;
            }
            resolve(stats);
        };
        request.onerror = () => resolve({ total: 0, completed: 0, failed: 0, pending: 0 });
    });
};

export const getPaginatedResults = async (page: number, limit: number): Promise<ScanResult[]> => {
    const db = await openDB();
    return new Promise<ScanResult[]>((resolve) => {
        const tx = db.transaction('results', 'readonly');
        const store = tx.objectStore('results');
        
        const results: ScanResult[] = [];
        const skip = (page - 1) * limit;
        let count = 0;
        let gathered = 0;

        const request = store.openCursor();
        request.onsuccess = (event) => {
            const cursor = (event.target as IDBRequest).result as IDBCursorWithValue;
            if (!cursor) {
                resolve(results);
                return;
            }

            if (count < skip) {
                const advanceBy = skip - count;
                count += advanceBy;
                cursor.advance(advanceBy);
                return;
            }

            results.push(cursor.value);
            gathered++;
            
            if (gathered < limit) {
                cursor.continue();
            } else {
                resolve(results);
            }
        };
        request.onerror = () => resolve([]);
    });
};

export const getNextPendingItem = async (): Promise<ScanResult | null> => {
    const db = await openDB();
    return new Promise<ScanResult | null>((resolve) => {
        const tx = db.transaction('results', 'readonly');
        const store = tx.objectStore('results');
        const request = store.openCursor();

        request.onsuccess = (event) => {
            const cursor = (event.target as IDBRequest).result as IDBCursorWithValue;
            if (cursor) {
                const item = cursor.value as ScanResult;
                if (item.status === ScanStatus.PENDING || item.status === ScanStatus.PROCESSING) {
                    resolve(item);
                    return;
                }
                cursor.continue();
            } else {
                resolve(null);
            }
        };
        request.onerror = () => resolve(null);
    });
};

// NEW: Export Helper to get EVERYTHING
export const getAllResults = async (): Promise<ScanResult[]> => {
    const db = await openDB();
    return new Promise<ScanResult[]>((resolve) => {
        const tx = db.transaction('results', 'readonly');
        const store = tx.objectStore('results');
        const request = store.getAll();
        request.onsuccess = () => {
             resolve(request.result as ScanResult[]);
        };
        request.onerror = () => {
             console.error("Failed to fetch all results");
             resolve([]);
        };
    });
};

// --- WRITE METHODS ---

export const saveResultsToDB = async (results: ScanResult[]) => {
  const db = await openDB();
  const tx = db.transaction('results', 'readwrite');
  const store = tx.objectStore('results');
  
  for (const r of results) {
    store.put(r);
  }
  
  return new Promise<void>((resolve) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    if (tx.commit) tx.commit();
  });
};

export const upsertResult = async (result: ScanResult) => {
    const db = await openDB();
    const tx = db.transaction('results', 'readwrite');
    const store = tx.objectStore('results');
    store.put(result);
    return new Promise<void>((resolve) => {
        tx.oncomplete = () => resolve();
        if (tx.commit) tx.commit();
    });
};

export const saveSegmentsToDB = async (segments: Segment[]) => {
  const db = await openDB();
  const tx = db.transaction('segments', 'readwrite');
  const store = tx.objectStore('segments');
  store.clear();
  for (const s of segments) {
    store.put(s);
  }
  return new Promise<void>((resolve) => {
    tx.oncomplete = () => resolve();
    if (tx.commit) tx.commit();
  });
};

export const saveSettingsToDB = async (settings: AppSettings) => {
  const db = await openDB();
  const tx = db.transaction('settings', 'readwrite');
  const store = tx.objectStore('settings');
  store.put({ key: 'config', ...settings });
  return new Promise<void>((resolve) => {
    tx.oncomplete = () => resolve();
    if (tx.commit) tx.commit();
  });
};

export const loadSegmentsAndSettings = async () => {
  const db = await openDB();
  
  const getStoreData = (storeName: string) => {
    return new Promise<any[]>((resolve) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve([]);
    });
  };

  const segments = await getStoreData('segments');
  const settingsRaw = await getStoreData('settings');
  const settings = settingsRaw.find(x => x.key === 'config') || { autoSync: false };

  return { segments, settings };
};

export const clearDB = async () => {
    const db = await openDB();
    const tx = db.transaction(['results', 'segments'], 'readwrite');
    tx.objectStore('results').clear();
    tx.objectStore('segments').clear();

    return new Promise<void>((resolve) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        if (tx.commit) tx.commit();
    });
};

export const syncRowToSheet = async (result: ScanResult, segmentName: string, scriptUrl: string): Promise<boolean> => {
    if (!result.enrichedData) return false;

    const originalData = result.originalRow || {};
    
    const payload = {
        ...originalData,
        url: result.url,
        segment: segmentName,
        "AI_Jmeno": result.enrichedData.firstName || "", 
        "AI_Prijmeni": result.enrichedData.lastName || "",
        "AI_Osoba_Cele": result.enrichedData.personName || "",
        "AI_Role": result.enrichedData.personRole || "",
        "AI_Osloveni": result.enrichedData.salutation || "",
        "AI_Email": result.enrichedData.email || "",
        "AI_ICO": result.enrichedData.ico || "",
        "AI_Jazyk": result.enrichedData.language || "",
        "AI_Typ_Kontaktu": result.enrichedData.contactType || "none",
        "AI_Prehled": result.enrichedData.overview || "",
        "AI_Icebreaker": result.enrichedData.icebreaker || "",
        "AI_Hodnoceni": result.enrichedData.rating ?? "",
        
        personName: result.enrichedData.personName || "",
        personRole: result.enrichedData.personRole || "",
        email: result.enrichedData.email || "",
        ico: result.enrichedData.ico || "",
        language: result.enrichedData.language || "",
    };

    // Randomized delay to prevent Google API rate limits
    await new Promise(resolve => setTimeout(resolve, Math.random() * 2000));

    try {
        await fetch(scriptUrl, {
            method: 'POST',
            mode: 'no-cors', 
            credentials: 'omit',
            keepalive: true,
            body: JSON.stringify(payload)
        });
        return true;
    } catch (e) {
        console.error("Sync failed", e);
        return false;
    }
};