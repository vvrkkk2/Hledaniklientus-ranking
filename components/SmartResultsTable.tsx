import React, { useState, useEffect } from 'react';
import { ScanResult, ScanStatus, Segment, ContactType } from '../types';
import { getPaginatedResults, getAllResults } from '../services/storageService';
import { CheckCircle2, XCircle, Loader2, User, Mail, Building2, ChevronDown, ChevronUp, Download, Cloud, Link as LinkIcon, RefreshCw, BadgeCheck, HelpCircle, ShieldAlert, ChevronLeft, ChevronRight, MessageSquareQuote } from 'lucide-react';

interface SmartResultsTableProps {
  totalCount: number;
  completedCount: number;
  segments: Segment[];
  onRetry: (id: string) => void;
  lastUpdated: number; // Trigger for refetching
}

const ITEMS_PER_PAGE = 50;

const SmartResultsTable: React.FC<SmartResultsTableProps> = ({ totalCount, completedCount, segments, onRetry, lastUpdated }) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [data, setData] = useState<ScanResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // Fetch data only for current page
  useEffect(() => {
      const fetchData = async () => {
          setLoading(true);
          const pageData = await getPaginatedResults(currentPage, ITEMS_PER_PAGE);
          setData(pageData);
          setLoading(false);
      };
      fetchData();
  }, [currentPage, lastUpdated]);

  const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE);

  const getSegmentName = (id?: string) => segments.find(s => s.id === id)?.name || 'Obecné';

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  const handleRetryClick = (e: React.MouseEvent, id: string) => {
      e.stopPropagation(); // Prevent row expansion
      onRetry(id);
  };

  const handleExport = async () => {
    if (isExporting) return;
    setIsExporting(true);

    try {
        // 1. Fetch ALL data from DB
        const allResults = await getAllResults();
        
        if (allResults.length === 0) {
            alert("Žádná data k exportu.");
            setIsExporting(false);
            return;
        }

        // 2. Prepare headers
        const allOriginalKeys = new Set<string>();
        allResults.forEach(r => {
            if (r.originalRow) {
                Object.keys(r.originalRow).forEach(k => allOriginalKeys.add(k));
            }
        });
        const sortedOriginalKeys = Array.from(allOriginalKeys);

        const aiColumns = [
            "AI_Segment", "AI_Status", 
            "AI_Typ_Kontaktu",
            "AI_Osloveni",
            "AI_Jmeno", "AI_Prijmeni", "AI_Osoba_Cele", 
            "AI_Role", "AI_Email", "AI_ICO", "AI_Kontext",
            "AI_Prehled", "AI_Icebreaker", "AI_Hodnoceni"
        ];

        const fullHeader = ["URL", ...sortedOriginalKeys, ...aiColumns];

        // 3. Helper for escaping CSV
        const escape = (val: string | null | undefined | number) => {
            if (val === null || val === undefined) return '';
            const s = String(val);
            if (s.includes(',') || s.includes('"') || s.includes('\n')) {
                return `"${s.replace(/"/g, '""')}"`;
            }
            return s;
        };

        // 4. Generate CSV Lines
        const csvRows = allResults.map(r => {
            const origVals = sortedOriginalKeys.map(k => escape(r.originalRow?.[k]));
            const segmentName = segments.find(s => s.id === r.segmentId)?.name || 'Obecné';
            
            const newVals = [
                escape(segmentName),
                r.status,
                escape(r.enrichedData?.contactType),
                escape(r.enrichedData?.salutation),
                escape(r.enrichedData?.firstName),
                escape(r.enrichedData?.lastName),
                escape(r.enrichedData?.personName),
                escape(r.enrichedData?.personRole),
                escape(r.enrichedData?.email),
                escape(r.enrichedData?.ico),
                escape(r.enrichedData?.companyContext),
                escape(r.enrichedData?.overview),
                escape(r.enrichedData?.icebreaker),
                escape(r.enrichedData?.rating)
            ];

            return [escape(r.url), ...origVals, ...newVals].join(",");
        });

        // 5. Create Blob and Download
        const csvString = [fullHeader.join(","), ...csvRows].join("\n");
        const blob = new Blob(["\uFEFF" + csvString], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        
        const link = document.createElement("a");
        link.href = url;
        link.setAttribute("download", `smart_outreach_export_${allResults.length}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

    } catch (e) {
        console.error("Export failed", e);
        alert("Export se nezdařil. Zkuste to prosím znovu.");
    } finally {
        setIsExporting(false);
    }
  };

  const renderContactBadge = (type?: ContactType) => {
      if (type === 'person') {
          return (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-700 border border-green-200">
                  <BadgeCheck className="w-3.5 h-3.5" />
                  Konkrétní osoba
              </span>
          );
      }
      if (type === 'generic') {
          return (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                  <HelpCircle className="w-3.5 h-3.5" />
                  Obecný kontakt
              </span>
          );
      }
      return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-500 border border-slate-200">
              <ShieldAlert className="w-3.5 h-3.5" />
              Nenalezeno
          </span>
      );
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden animate-in fade-in slide-in-from-bottom-8 flex flex-col h-full">
      <div className="p-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center sticky top-0 z-10">
        <div>
           <h3 className="font-bold text-slate-800">Nalezené Kontakty</h3>
           <p className="text-xs text-slate-500">Zpracováno {completedCount} / {totalCount}</p>
        </div>
        <div className="flex items-center gap-3">
             {/* Pagination Controls */}
            <div className="flex items-center bg-white rounded-lg border border-slate-200 p-1">
                <button 
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1 || loading}
                    className="p-1 hover:bg-slate-100 rounded disabled:opacity-30"
                >
                    <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="px-3 text-xs font-mono text-slate-600">
                    {currentPage} / {totalPages || 1}
                </span>
                <button 
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages || loading}
                    className="p-1 hover:bg-slate-100 rounded disabled:opacity-30"
                >
                    <ChevronRight className="w-4 h-4" />
                </button>
            </div>

            <button 
                onClick={handleExport} 
                disabled={isExporting}
                className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors disabled:opacity-50"
            >
                {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                {isExporting ? 'Exportuji...' : 'CSV'}
            </button>
        </div>
      </div>

      <div className="overflow-x-auto min-h-[500px]">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="bg-slate-50 text-slate-600 border-b border-slate-200">
              <th className="px-4 py-3 font-medium">Firma / URL</th>
              <th className="px-4 py-3 font-medium">Typ Kontaktu</th>
              <th className="px-4 py-3 font-medium">Osoba / Email</th>
              <th className="px-4 py-3 font-medium text-right">Stav</th>
              <th className="px-4 py-3 w-10"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
                <tr><td colSpan={5} className="p-8 text-center text-slate-400">Načítám data...</td></tr>
            ) : data.map((r) => {
              const isExpanded = expandedId === r.id;
              const hasData = r.status === ScanStatus.COMPLETED && r.enrichedData;
              const hasError = r.status === ScanStatus.FAILED;
              const isProcessing = r.status === ScanStatus.PROCESSING;

              return (
                <React.Fragment key={r.id}>
                  <tr 
                    className={`hover:bg-slate-50 transition-colors cursor-pointer ${isExpanded ? 'bg-indigo-50/30' : ''}`}
                    onClick={() => hasData && toggleExpand(r.id)}
                  >
                    <td className="px-4 py-3 font-medium text-slate-900 max-w-[250px] truncate">
                      <div className="flex flex-col">
                        <span className="truncate">{r.url}</span>
                        {r.enrichedData?.companyContext && (
                          <span className="text-xs text-slate-500 truncate">{r.enrichedData.companyContext}</span>
                        )}
                        {hasError && (
                            <span className="text-xs text-red-500 font-mono mt-0.5">{r.error}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                        {hasData && renderContactBadge(r.enrichedData?.contactType)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col">
                        {r.enrichedData?.personName ? (
                            <div className="flex items-center gap-1.5 text-slate-900 font-medium">
                                <User className="w-3.5 h-3.5 text-indigo-500" />
                                {r.enrichedData.personName}
                            </div>
                        ) : null}
                        {r.enrichedData?.email ? (
                            <div className="text-slate-600 flex items-center gap-1.5">
                                <Mail className="w-3.5 h-3.5 text-slate-400" />
                                {r.enrichedData.email}
                            </div>
                        ) : <span className="text-slate-400 text-xs italic">Email nenalezen</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                       <div className="flex items-center justify-end gap-2">
                           {r.syncedToSheets && (
                               <span title="Uloženo na Google Drive">
                                   <Cloud className="w-3 h-3 text-green-500" />
                               </span>
                           )}
                           
                           {/* RETRY BUTTON */}
                           {!isProcessing && (r.status === ScanStatus.FAILED || r.status === ScanStatus.COMPLETED) && (
                               <button 
                                onClick={(e) => handleRetryClick(e, r.id)}
                                className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-full transition-colors"
                                title="Zkusit znovu"
                               >
                                   <RefreshCw className="w-4 h-4" />
                               </button>
                           )}

                           {r.status === ScanStatus.PENDING && <span className="text-slate-400 text-xs">Čeká</span>}
                           {r.status === ScanStatus.PROCESSING && <Loader2 className="w-4 h-4 animate-spin text-blue-500 ml-auto" />}
                           {r.status === ScanStatus.COMPLETED && <CheckCircle2 className="w-4 h-4 text-green-500" />}
                           {r.status === ScanStatus.FAILED && (
                               <div className="group relative">
                                   <XCircle className="w-4 h-4 text-red-500 ml-auto" />
                                   <div className="absolute right-0 bottom-6 w-64 bg-slate-800 text-white text-xs rounded p-2 hidden group-hover:block z-50 shadow-lg">
                                       {r.error || "Neznámá chyba"}
                                   </div>
                               </div>
                           )}
                       </div>
                    </td>
                    <td className="px-4 py-3 text-center text-slate-400">
                      {hasData && (isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />)}
                    </td>
                  </tr>
                  
                  {/* Expanded Detail View */}
                  {isExpanded && hasData && (
                    <tr className="bg-slate-50/50">
                      <td colSpan={5} className="p-4">
                        <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-6">
                           <div className="flex flex-col md:flex-row gap-6">
                                {/* Main Info */}
                                <div className="flex-1 space-y-4">
                                    <div className="flex items-center gap-2 mb-2">
                                        <Building2 className="w-5 h-5 text-indigo-600" />
                                        <h4 className="font-bold text-lg text-slate-800">Detail firmy</h4>
                                    </div>
                                    
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                                        <div className="space-y-2">
                                            <p className="text-slate-500">URL</p>
                                            <a href={r.url} target="_blank" className="text-blue-600 hover:underline block truncate">{r.url}</a>
                                        </div>
                                        <div className="space-y-2">
                                            <p className="text-slate-500">Obor / Segment</p>
                                            <span className="px-2 py-1 bg-slate-100 rounded text-slate-700 font-medium">{getSegmentName(r.segmentId)}</span>
                                        </div>
                                        <div className="space-y-2">
                                            <p className="text-slate-500">IČO</p>
                                            <p className="font-mono text-slate-800">{r.enrichedData?.ico || '-'}</p>
                                        </div>
                                        <div className="space-y-2">
                                            <p className="text-slate-500">Jazyk webu</p>
                                            <p className="uppercase font-bold text-slate-700">{r.enrichedData?.language || '-'}</p>
                                        </div>
                                    </div>

                                    <div className="mt-4 p-3 bg-slate-50 rounded-lg border border-slate-200">
                                        <p className="text-xs font-semibold text-slate-400 uppercase mb-1">Popis činnosti</p>
                                        <p className="text-slate-700">{r.enrichedData?.companyContext}</p>
                                    </div>

                                    {r.enrichedData?.overview && (
                                        <div className="mt-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
                                            <p className="text-xs font-semibold text-blue-600 uppercase mb-1">Základní přehled</p>
                                            <p className="text-slate-700">{r.enrichedData.overview}</p>
                                        </div>
                                    )}

                                    {r.enrichedData?.icebreaker && (
                                        <div className="mt-4 p-3 bg-indigo-50 rounded-lg border border-indigo-200">
                                            <p className="text-xs font-semibold text-indigo-600 uppercase mb-1">Tip na Icebreaker</p>
                                            <p className="text-slate-700 italic">"{r.enrichedData.icebreaker}"</p>
                                        </div>
                                    )}
                                </div>

                                {/* Contact Card */}
                                <div className="md:w-1/3">
                                    <div className={`h-full rounded-xl border p-5 flex flex-col justify-center ${r.enrichedData?.contactType === 'person' ? 'bg-green-50 border-green-200' : 'bg-blue-50 border-blue-200'}`}>
                                        <div className="mb-4 flex justify-between items-center">
                                            {renderContactBadge(r.enrichedData?.contactType)}
                                            {r.enrichedData?.rating !== undefined && (
                                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-yellow-100 text-yellow-800 border border-yellow-200">
                                                    Skóre: {r.enrichedData.rating}/10
                                                </span>
                                            )}
                                        </div>

                                        <div className="space-y-3">
                                            <div>
                                                <p className="text-xs uppercase font-semibold opacity-60 mb-1">Kontaktní osoba</p>
                                                <p className="text-lg font-bold text-slate-900">{r.enrichedData?.personName || "Nenalezeno"}</p>
                                                {r.enrichedData?.personRole && <p className="text-sm text-slate-600">{r.enrichedData.personRole}</p>}
                                            </div>

                                            {r.enrichedData?.salutation && (
                                                <div className="py-2">
                                                    <p className="text-xs uppercase font-semibold opacity-60 mb-1 flex items-center gap-1">
                                                        <MessageSquareQuote className="w-3 h-3" /> Doporučené oslovení
                                                    </p>
                                                    <p className="text-slate-800 font-medium italic">"{r.enrichedData.salutation}"</p>
                                                </div>
                                            )}

                                            <div className="pt-3 border-t border-black/5">
                                                <p className="text-xs uppercase font-semibold opacity-60 mb-1">E-mail</p>
                                                {r.enrichedData?.email ? (
                                                     <div className="flex items-center gap-2 text-slate-900 font-mono font-medium break-all">
                                                        <Mail className="w-4 h-4 shrink-0" />
                                                        {r.enrichedData.email}
                                                     </div>
                                                ) : <span className="text-red-500 text-sm font-medium">Email nenalezen</span>}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                           </div>

                           {/* Sources */}
                           {r.enrichedData?.groundingSources && r.enrichedData.groundingSources.length > 0 && (
                                <div className="mt-6 pt-4 border-t border-slate-100">
                                    <p className="text-xs font-semibold text-slate-400 mb-2 flex items-center gap-1">
                                        <LinkIcon className="w-3 h-3" /> Zdroje informací
                                    </p>
                                    <div className="flex flex-wrap gap-2">
                                        {r.enrichedData.groundingSources.map((source, idx) => (
                                            <a 
                                                key={idx}
                                                href={source.uri}
                                                target="_blank" 
                                                rel="noopener noreferrer"
                                                className="text-xs text-blue-600 bg-blue-50 hover:bg-blue-100 px-2 py-1 rounded border border-blue-100 truncate max-w-[300px]"
                                            >
                                                {source.title || source.uri}
                                            </a>
                                        ))}
                                    </div>
                                </div>
                           )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default SmartResultsTable;