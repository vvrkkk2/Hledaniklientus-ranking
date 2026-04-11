import React, { useState, useRef } from 'react';
import { Upload, Play, Trash2, Globe, FileSpreadsheet, X, Target, Briefcase } from 'lucide-react';
import { InputItem, AppSettings } from '../types';
import { parseCSV, findUrlColumn } from '../utils/csvHelper';

interface InputSectionProps {
  onStart: (items: InputItem[]) => void;
  isProcessing: boolean;
  settings: AppSettings;
  onSettingsChange: (settings: AppSettings) => void;
  onAlert?: (msg: string) => void;
}

const InputSection: React.FC<InputSectionProps> = ({ onStart, isProcessing, settings, onSettingsChange, onAlert }) => {
  const [inputText, setInputText] = useState('');
  const [csvFile, setCsvFile] = useState<{ name: string; items: InputItem[] } | null>(null);
  const [pendingCsv, setPendingCsv] = useState<{
    filename: string;
    rows: Record<string, string>[];
    headers: string[];
    selectedUrlCol: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleStart = () => {
    if (csvFile) {
      onStart(csvFile.items);
      return;
    }

    if (!inputText.trim()) return;
    
    // Legacy text area mode
    const urls = inputText
      .split(/[\n, ]+/)
      .map((u) => u.trim())
      .filter((u) => u.length > 0)
      .map((u) => u.startsWith('http') ? u : `https://${u}`);

    const uniqueUrls = Array.from(new Set(urls));
    
    if (uniqueUrls.length > 0) {
      onStart(uniqueUrls.map(url => ({ url })));
    }
  };

  const handleClear = () => {
    setInputText('');
    setCsvFile(null);
    setPendingCsv(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleConfirmCsv = () => {
    if (!pendingCsv) return;
    const { filename, rows, selectedUrlCol } = pendingCsv;
    const items: InputItem[] = rows
      .filter(row => row[selectedUrlCol] && row[selectedUrlCol].length > 3)
      .map(row => {
        let url = row[selectedUrlCol].trim();
        if (!url.startsWith('http')) url = `https://${url}`;
        return {
          url,
          originalRow: row
        };
      });
    
    setCsvFile({
      name: filename,
      items
    });
    setInputText('');
    setPendingCsv(null);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;

      if (file.name.endsWith('.csv')) {
        try {
          const rows = parseCSV(content);
          if (rows.length > 0) {
            const headers = Object.keys(rows[0]);
            const urlCol = findUrlColumn(rows[0]) || headers[0];
            
            setPendingCsv({
              filename: file.name,
              rows,
              headers,
              selectedUrlCol: urlCol
            });
            return;
          }
        } catch (err) {
          console.error("CSV Parse error", err);
          if (onAlert) onAlert("Nepodařilo se zpracovat CSV soubor. Zkontrolujte formát.");
        }
      }

      // Fallback for TXT or failed CSV detection: just dump to text area
      setInputText(content);
    };
    reader.readAsText(file);
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-8">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
          <Globe className="w-5 h-5 text-blue-600" />
          Vložit webové stránky
        </h2>
        <div className="flex gap-2">
           <label className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-slate-600 bg-slate-100 rounded-lg cursor-pointer hover:bg-slate-200 transition-colors">
            <Upload className="w-4 h-4" />
            Nahrát CSV/TXT
            <input 
              ref={fileInputRef}
              type="file" 
              accept=".csv,.txt" 
              className="hidden" 
              onChange={handleFileUpload} 
            />
          </label>
          <button
            onClick={handleClear}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-colors"
            disabled={isProcessing}
          >
            <Trash2 className="w-4 h-4" />
            Vymazat
          </button>
        </div>
      </div>

      {pendingCsv ? (
        <div className="w-full p-6 bg-indigo-50 border border-indigo-200 rounded-lg flex flex-col items-center justify-center text-indigo-900 gap-4 relative">
            <FileSpreadsheet className="w-12 h-12 text-indigo-500" />
            <div className="text-center w-full max-w-md">
                <p className="font-semibold text-lg">{pendingCsv.filename}</p>
                <p className="text-sm opacity-80 mt-1 mb-4">
                  Načteno {pendingCsv.rows.length} řádků.
                </p>
                <div className="bg-white p-4 rounded-lg border border-indigo-100 shadow-sm text-left">
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                        Který sloupec obsahuje webové stránky?
                    </label>
                    <select 
                        className="w-full p-2 border border-slate-300 rounded-md mb-4 focus:ring-2 focus:ring-indigo-500 outline-none"
                        value={pendingCsv.selectedUrlCol}
                        onChange={(e) => setPendingCsv({...pendingCsv, selectedUrlCol: e.target.value})}
                    >
                        {pendingCsv.headers.map(h => (
                            <option key={h} value={h}>{h}</option>
                        ))}
                    </select>
                    <button 
                        onClick={handleConfirmCsv}
                        className="w-full py-2 bg-indigo-600 text-white rounded-md font-medium hover:bg-indigo-700 transition-colors"
                    >
                        Potvrdit výběr
                    </button>
                </div>
            </div>
            <button 
              onClick={handleClear}
              className="absolute top-4 right-4 p-1 hover:bg-indigo-100 rounded-full transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
        </div>
      ) : csvFile ? (
        <div className="w-full h-48 p-4 bg-blue-50 border border-blue-200 rounded-lg flex flex-col items-center justify-center text-blue-800 gap-3 relative">
            <FileSpreadsheet className="w-12 h-12 text-blue-500" />
            <div className="text-center">
                <p className="font-semibold">{csvFile.name}</p>
                <p className="text-sm opacity-80 mt-1">
                  Načteno {csvFile.items.length} řádků. 
                  <br/>
                  <span className="font-medium text-blue-700">AI nyní analyzuje VŠECHNY sloupce z vašeho CSV</span> a propojuje je s daty z webu.
                </p>
            </div>
            <button 
              onClick={handleClear}
              className="absolute top-4 right-4 p-1 hover:bg-blue-100 rounded-full transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
        </div>
      ) : (
        <textarea
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder={`Vložte URL adresy, každou na nový řádek.\nNebo nahrajte CSV soubor a my doplníme chybějící emaily.`}
          className="w-full h-48 p-4 text-slate-700 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none font-mono text-sm"
          disabled={isProcessing}
        />
      )}

      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700 mb-2">
            <Target className="w-4 h-4 text-blue-600" />
            Profil ideálního klienta
          </label>
          <textarea
            value={settings.idealClientProfile || ''}
            onChange={(e) => onSettingsChange({ ...settings, idealClientProfile: e.target.value })}
            placeholder="Např. Hledáme e-shopy s obratem nad 10M Kč, které používají Shoptet..."
            className="w-full h-24 p-3 text-slate-700 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none text-sm"
            disabled={isProcessing}
          />
        </div>
        <div>
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700 mb-2">
            <Briefcase className="w-4 h-4 text-blue-600" />
            Popis naší služby
          </label>
          <textarea
            value={settings.serviceDescription || ''}
            onChange={(e) => onSettingsChange({ ...settings, serviceDescription: e.target.value })}
            placeholder="Např. Pomáháme e-shopům zvýšit konverzní poměr pomocí personalizace..."
            className="w-full h-24 p-3 text-slate-700 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none text-sm"
            disabled={isProcessing}
          />
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3 bg-slate-50 p-3 rounded-lg border border-slate-200">
        <input 
            type="checkbox" 
            id="searchEmails"
            className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
            checked={settings.searchEmails !== false}
            onChange={(e) => onSettingsChange({ ...settings, searchEmails: e.target.checked })}
            disabled={isProcessing}
        />
        <label htmlFor="searchEmails" className="text-sm font-medium text-slate-700 cursor-pointer">
            Hledat kontaktní údaje (e-maily, jména osob)
        </label>
      </div>

      <div className="mt-6 flex justify-end">
        <button
          onClick={handleStart}
          disabled={isProcessing || (!inputText.trim() && !csvFile)}
          className={`flex items-center gap-2 px-6 py-2.5 rounded-lg font-semibold text-white transition-all ${
            isProcessing || (!inputText.trim() && !csvFile)
              ? 'bg-slate-400 cursor-not-allowed'
              : 'bg-blue-600 hover:bg-blue-700 shadow-md hover:shadow-lg'
          }`}
        >
          {isProcessing ? (
            <>
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Zpracovávám...
            </>
          ) : (
            <>
              <Play className="w-5 h-5" />
              Spustit vyhledávání
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export default InputSection;
