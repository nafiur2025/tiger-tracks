import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInAnonymously, 
  onAuthStateChanged,
  signInWithCustomToken,
  User
} from 'firebase/auth';
import { 
  getFirestore, 
  collection, 
  addDoc, 
  query, 
  where,
  onSnapshot, 
  doc, 
  updateDoc, 
  serverTimestamp,
  deleteDoc
} from 'firebase/firestore';
import { 
  Plus, 
  MapPin, 
  CheckSquare, 
  Camera, 
  Activity, 
  Zap, 
  User as UserIcon,
  Briefcase,
  Copy,
  ArrowLeft,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Calendar,
  Clock,
  Phone,
  Truck,
  ClipboardList,
  AlertTriangle,
  Server,
  Monitor,
  Locate,
  Image as ImageIcon,
  X,
  Eye,
  Trash2
} from 'lucide-react';

// --- Configuration ---
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCCY-p7VgnLI4w6QSz7AaW2vSAxwRHNMJI",
  authDomain: "tiger-tracks-a2687.firebaseapp.com",
  projectId: "tiger-tracks-a2687",
  storageBucket: "tiger-tracks-a2687.firebasestorage.app",
  messagingSenderId: "845187069330",
  appId: "1:845187069330:web:6d53be3c4a2cf77f143d4b",
  measurementId: "G-TQLND10HMB"
};
const APP_ID = 'tiger-tracks';

// --- Firebase Init ---
const app = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);
const db = getFirestore(app);

// --- Types & SOP Definitions ---

type Role = 'operator' | 'tiger';
type Answer = 'Yes' | 'No' | 'N/A' | '';

type SiteStatus = 
  | 'lead'          
  | 'checklist_done' 
  | 'submitted'      
  | 'visit_proposed' 
  | 'visit_confirmed'
  | 'tech_visit'     
  | 'decision_pending' 
  | 'approved'      
  | 'install_proposed' 
  | 'install_confirmed'
  | 'rejected'      
  | 'deferred'      
  | 'contract_ready' 
  | 'installed'     
  | 'operational';  

interface PhotoData {
  id?: string;
  category: string; // 'Front', 'Entrance', 'Additional', etc.
  base64: string;
  timestamp: any;
}

interface ChecklistData {
  // 1. Basic
  siteType: string;
  ownershipProof: 'Yes' | 'No' | 'Pending';
  gpsCoordinates: string;
  // Photos are now tracked by simple boolean flags in the main doc for summary, 
  // but actual data is in sub-collection/separate collection.
  photosTaken: {
    front: boolean;
    entrance: boolean;
    installSpot: boolean;
    meter: boolean;
    roads: boolean;
    additional: number;
  };
  
  // 2. Riders & Demand
  riderType: string[]; 
  avgIncome: string;
  ridersInArea: string;
  ridersInGarage: string;

  // 3. Road Access
  mainRoadAccessible: Answer;
  timeRestrictions: Answer;
  permitsRequired: Answer;
  roadNotes: string;

  // 4. Flood
  noFloodHistory: Answer;
  notLowLying: Answer;
  floodEvidence: string;

  // 5. Tech & Power
  lineType: 'LTD3' | 'Connectable' | 'No';
  threePhase: Answer;
  capacityLoad: string; 
  grounding: Answer;
  pointIdentified: Answer;
  meterPic: Answer;

  // 6. Reliability
  noFrequentOutages: Answer;
  outageFreq: string;
  outageDur: string;
  loadShedding: Answer;

  // 7. Install & Security
  spaceVentilation: Answer;
  rainProtection: 'Canopy' | 'Indoor' | 'Platform' | '';
  network: '4G' | 'Broadband' | '';
  security: string[]; 

  // 8. Commercial
  ownerWilling: Answer;
  collabModel: 'Purchase' | 'Only Use' | 'Trial' | '';
  userReadiness: string;
  benefitUnderstood: Answer;
  concerns: string;
}

interface SiteData {
  id: string;
  siteId: string; 
  name: string;
  address: string;
  ownerName: string;
  ownerPhone: string;
  status: SiteStatus;
  
  visitDate?: string; 

  checklist?: ChecklistData;
  
  techAssessment?: {
    electrical: boolean;
    ventilation: boolean;
    connectivity: boolean;
    risks: string;
    preconditions: string;
  };
  
  decision?: {
    result: 'GO' | 'NO-GO' | 'DEFER';
    notes: string;
    targetDate?: string;
  };
  
  installation?: {
    date: string;
    picName: string;
    picPhone: string;
  };

  deployment?: {
    cabinetSerial: string;
    batteryCount: string;
    dashboardId: string;
    deployedAt: any;
  };

  createdAt: any;
  updatedAt: any;
}

// --- Logic: Reports ---

const calculateSectionStatus = (c: ChecklistData) => {
  const basic = c.siteType && c.ownershipProof !== 'No' ? 'Y' : 'N';
  const demand = c.avgIncome && c.ridersInGarage ? 'Y' : 'N';
  const road = (c.mainRoadAccessible === 'Yes') ? 'Y' : 'N';
  const flood = (c.noFloodHistory === 'Yes' && c.notLowLying === 'Yes') ? 'Y' : 'N';
  const power = (c.threePhase === 'Yes' && c.capacityLoad && parseFloat(c.capacityLoad) > 0) ? 'Y' : 'N';
  const outages = (c.noFrequentOutages === 'Yes') ? 'Y' : 'N';
  const install = (c.spaceVentilation === 'Yes') ? 'Y' : 'N';
  const commercial = (c.ownerWilling === 'Yes') ? 'Y' : 'N';
  return { basic, demand, road, flood, power, outages, install, commercial };
};

const generateWhatsAppReport = (site: SiteData) => {
  if (!site.checklist) return '';
  const c = site.checklist;
  const s = calculateSectionStatus(c);
  const fmt = (val: string) => val === 'Y' ? '☑Y/☐N' : '☐Y/☑N';
  const summaryLine = `basic info: ${fmt(s.basic)} | demand: ${fmt(s.demand)} | road access: ${fmt(s.road)} | flood risk: ${fmt(s.flood)} | power readiness: ${fmt(s.power)} | outages: ${fmt(s.outages)} | install/security: ${fmt(s.install)} | commercial: ${fmt(s.commercial)}`;

  return `
"[SITE] ${site.siteId}"
${summaryLine}
Capacity: ${c.capacityLoad} kW
GPS: ${c.gpsCoordinates || 'N/A'}
Notes: ${c.roadNotes || c.concerns || 'None'}
Assessor: Operator
Date: ${new Date().toLocaleDateString()}
`.trim();
};

const generateDecisionReport = (site: SiteData) => {
  if (!site.decision) return '';
  const d = site.decision;
  const icon = d.result === 'GO' ? '✅' : d.result === 'NO-GO' ? '❌' : '⏸️';
  
  return `
[DECISION] SITE ID: ${site.siteId} — ${d.result} ${icon}
Conditions (if any):
${site.techAssessment?.preconditions || 'None'}
Target delivery window: ${d.targetDate || 'TBD'}
Owner readiness confirmed by: Operator
`.trim();
};

// --- Utilities ---

// Resize image to avoid Firestore 1MB limit. Returns Base64.
const resizeImage = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 800; 
        const scaleSize = MAX_WIDTH / img.width;
        canvas.width = MAX_WIDTH;
        canvas.height = img.height * scaleSize;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.7)); // Compress to 70% quality JPEG
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
  });
};

// --- Components ---

interface CardProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  onLongPress?: () => void;
}

const Card = ({ children, className = '', onClick, onLongPress }: CardProps) => {
  const timerRef = useRef<any>(null);
  const isLongPress = useRef(false);

  const startPress = () => {
    isLongPress.current = false;
    timerRef.current = setTimeout(() => {
      isLongPress.current = true;
      if (onLongPress) onLongPress();
    }, 800); // 800ms threshold for long press
  };

  const endPress = () => {
    clearTimeout(timerRef.current);
  };

  const handleClick = () => {
    if (!isLongPress.current && onClick) {
      onClick();
    }
  };

  return (
    <div 
      onMouseDown={startPress}
      onMouseUp={endPress}
      onMouseLeave={endPress}
      onTouchStart={startPress}
      onTouchEnd={endPress}
      onClick={handleClick}
      className={`bg-white rounded-xl shadow-sm border border-slate-100 p-4 ${className} ${onClick ? 'active:scale-95 transition-transform cursor-pointer select-none' : ''}`}
    >
      {children}
    </div>
  );
};

const SectionHeader = ({ title, isOpen, toggle }: { title: string, isOpen: boolean, toggle: () => void }) => (
  <button 
    onClick={toggle}
    className="w-full flex items-center justify-between py-3 px-1 border-b border-slate-100 text-left mb-2 group"
  >
    <span className="font-bold text-slate-800 text-sm group-hover:text-blue-600 transition-colors">{title}</span>
    {isOpen ? <ChevronUp size={16} className="text-slate-400"/> : <ChevronDown size={16} className="text-slate-400"/>}
  </button>
);

const YesNoSelect = ({ label, value, onChange, options = ['Yes', 'No'] }: { label: string, value: Answer, onChange: (v: Answer) => void, options?: string[] }) => (
  <div className="mb-4">
    <div className="text-sm font-medium text-slate-700 mb-2 leading-tight">{label}</div>
    <div className="flex gap-2">
      {options.map(opt => {
        const isActive = value === opt;
        return (
          <button
            key={opt}
            onClick={() => onChange(opt as Answer)}
            className={`flex-1 py-2.5 px-3 rounded-lg text-sm font-bold border transition-all ${
              isActive 
                ? 'bg-blue-600 text-white border-blue-600 shadow-md transform scale-[1.02]' 
                : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
            }`}
          >
            {opt}
          </button>
        );
      })}
    </div>
  </div>
);

const RadioGroup = ({ label, options, value, onChange }: { label: string, options: string[], value: string, onChange: (v: string) => void }) => (
  <div className="mb-4">
    <div className="text-xs font-bold text-slate-500 uppercase mb-2">{label}</div>
    <div className="flex flex-wrap gap-2">
      {options.map(opt => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          className={`px-3 py-2 rounded-lg text-xs font-bold border transition-all ${value === opt ? 'bg-blue-600 text-white border-blue-600 shadow-sm' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
        >
          {opt}
        </button>
      ))}
    </div>
  </div>
);

const InputField = ({ label, value, onChange, placeholder, type="text" }: any) => (
  <div className="mb-4">
    <div className="text-xs font-bold text-slate-500 uppercase mb-1">{label}</div>
    <input 
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-100 focus:border-blue-400 outline-none transition-all"
      placeholder={placeholder}
    />
  </div>
);

const ReadOnlyField = ({ label, value }: { label: string, value: string }) => (
  <div className="mb-2 pb-2 border-b border-slate-50 last:border-0">
    <div className="text-xs font-bold text-slate-400 uppercase mb-1">{label}</div>
    <div className="text-sm font-medium text-slate-800 break-words">{value || '-'}</div>
  </div>
);

// --- New Photo Component ---
const PhotoCapture = ({ label, category, siteId, onPhotoTaken }: { label: string, category: string, siteId: string, onPhotoTaken: () => void }) => {
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Check if photo exists on load
  useEffect(() => {
    if(!siteId) return;
    const q = query(
      collection(db, 'artifacts', APP_ID, 'public', 'data', 'photos'),
      where('siteId', '==', siteId),
      where('category', '==', category)
    );
    const unsub = onSnapshot(q, (snap) => {
      if (!snap.empty) {
        setPreview(snap.docs[0].data().base64);
      }
    });
    return () => unsub();
  }, [siteId, category]);

  const handleCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    try {
      const base64 = await resizeImage(file);
      
      // Save to separate photos collection
      await addDoc(collection(db, 'artifacts', APP_ID, 'public', 'data', 'photos'), {
        siteId,
        category,
        base64,
        timestamp: serverTimestamp()
      });
      
      setPreview(base64);
      onPhotoTaken(); // Callback to update parent checklist state
    } catch (err) {
      console.error(err);
      alert("Failed to save photo. Try a smaller image.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 mb-2">
      <div className="flex justify-between items-center mb-2">
        <span className="text-xs font-bold text-slate-700 uppercase">{label}</span>
        {preview && <span className="text-xs text-green-600 font-bold flex items-center gap-1"><CheckCircle size={12}/> Saved</span>}
      </div>
      
      {preview ? (
        <div className="relative">
          <img src={preview} alt={label} className="w-full h-32 object-cover rounded-lg" />
          <button 
            onClick={() => fileInputRef.current?.click()}
            className="absolute bottom-2 right-2 bg-black/50 text-white text-xs px-2 py-1 rounded backdrop-blur-sm"
          >
            Retake
          </button>
        </div>
      ) : (
        <button 
          onClick={() => fileInputRef.current?.click()}
          disabled={loading}
          className="w-full h-24 border-2 border-dashed border-slate-300 rounded-lg flex flex-col items-center justify-center text-slate-400 hover:border-blue-400 hover:text-blue-500 transition-colors"
        >
          {loading ? <Activity className="animate-spin"/> : <Camera size={24} />}
          <span className="text-xs font-bold mt-1">Tap to Capture</span>
        </button>
      )}
      
      <input 
        type="file" 
        ref={fileInputRef}
        accept="image/*" 
        capture="environment" // Use rear camera on mobile
        className="hidden" 
        onChange={handleCapture}
      />
    </div>
  );
};

const StatusBadge = ({ status }: { status: SiteStatus }) => {
  const styles: Record<SiteStatus, string> = {
    lead: 'bg-slate-100 text-slate-600',
    checklist_done: 'bg-blue-50 text-blue-600',
    submitted: 'bg-indigo-100 text-indigo-700',
    visit_proposed: 'bg-orange-100 text-orange-700',
    visit_confirmed: 'bg-orange-600 text-white',
    tech_visit: 'bg-purple-100 text-purple-700',
    decision_pending: 'bg-purple-50 text-purple-600',
    approved: 'bg-green-100 text-green-700',
    install_proposed: 'bg-teal-100 text-teal-700',
    install_confirmed: 'bg-teal-600 text-white',
    rejected: 'bg-red-100 text-red-700',
    deferred: 'bg-yellow-100 text-yellow-700',
    contract_ready: 'bg-cyan-100 text-cyan-700',
    installed: 'bg-indigo-600 text-white',
    operational: 'bg-emerald-100 text-emerald-800 border-emerald-200 border',
  };

  const labels: Record<SiteStatus, string> = {
    lead: 'Lead',
    checklist_done: 'Checked',
    submitted: 'Reviewing',
    visit_proposed: 'Visit Proposed',
    visit_confirmed: 'Confirmed',
    tech_visit: 'Tech Visit',
    decision_pending: 'Decision',
    approved: 'GO ✅',
    install_proposed: 'Inst. Proposed',
    install_confirmed: 'Inst. Confirmed',
    rejected: 'NO-GO ❌',
    deferred: 'DEFER ⏸️',
    contract_ready: 'Contract Ready',
    installed: 'Installed',
    operational: 'LIVE 🚀',
  };

  return (
    <span className={`px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${styles[status] || 'bg-gray-100'}`}>
      {labels[status]}
    </span>
  );
};

// 3. Main App Component
export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<Role>('operator');
  const [view, setView] = useState<'list' | 'create' | 'detail'>('list');
  const [sites, setSites] = useState<SiteData[]>([]);
  const [selectedSite, setSelectedSite] = useState<SiteData | null>(null);
  const [loading, setLoading] = useState(true);

  // Authentication
  useEffect(() => {
    const initAuth = async () => {
      if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
        await signInWithCustomToken(auth, __initial_auth_token);
      } else {
        await signInAnonymously(auth);
      }
    };
    initAuth();
    return onAuthStateChanged(auth, (u) => setUser(u));
  }, []);

  // Data Sync
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'artifacts', APP_ID, 'public', 'data', 'sites'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as SiteData));
      data.sort((a, b) => (b.updatedAt?.seconds || 0) - (a.updatedAt?.seconds || 0));
      setSites(data);
      setLoading(false);
    }, (err) => {
      console.error("Firestore Error:", err);
      setLoading(false);
    });
    return () => unsubscribe();
  }, [user]);

  // Actions
  const handleCreateSite = async (formData: any) => {
    if (!user) return;
    try {
      await addDoc(collection(db, 'artifacts', APP_ID, 'public', 'data', 'sites'), {
        ...formData,
        status: 'lead',
        checklist: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setView('list');
    } catch (e) {
      console.error(e);
      alert('Error creating site');
    }
  };

  const updateStatus = async (siteId: string, newStatus: SiteStatus, additionalData: any = {}) => {
    try {
      await updateDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sites', siteId), {
        status: newStatus,
        updatedAt: serverTimestamp(),
        ...additionalData
      });
      if (selectedSite) {
        setSelectedSite({ ...selectedSite, status: newStatus, ...additionalData });
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Delete Site Logic
  const handleDeleteSite = async (siteId: string, siteName: string) => {
    const code = window.prompt(`To DELETE "${siteName}", enter the Admin Code:`);
    if (code === ADMIN_CODE) {
      if (window.confirm(`Are you sure you want to permanently delete ${siteName}? This cannot be undone.`)) {
        try {
          await deleteDoc(doc(db, 'artifacts', APP_ID, 'public', 'data', 'sites', siteId));
          // Photos are in a separate collection, technically should be deleted too but for simplicity in this no-cloud-function setup, we leave them orphant.
          alert("Site deleted successfully.");
        } catch (e) {
          console.error("Error deleting site:", e);
          alert("Error deleting site.");
        }
      }
    } else if (code !== null) {
      alert("Incorrect Admin Code.");
    }
  };

  // Views
  if (!user || loading) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-400">
      <Activity className="w-8 h-8 animate-spin" />
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 font-sans pb-20">
      
      {/* Header */}
      <header className="bg-white px-4 py-4 sticky top-0 z-10 border-b border-slate-200 flex justify-between items-center shadow-sm">
        <div className="flex items-center gap-2">
          {view !== 'list' && (
            <button onClick={() => setView('list')} className="p-1 -ml-2 mr-1 rounded-full hover:bg-slate-100">
              <ArrowLeft className="w-6 h-6 text-slate-600" />
            </button>
          )}
          <h1 className="text-lg font-bold text-slate-800 truncate max-w-[200px]">
            {view === 'list' ? 'TigerTracks' : view === 'create' ? 'New Site' : selectedSite?.siteId}
          </h1>
        </div>
        
        <button 
          onClick={() => setRole(prev => prev === 'operator' ? 'tiger' : 'operator')}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold transition-all ${
            role === 'operator' 
              ? 'bg-blue-100 text-blue-700 border border-blue-200' 
              : 'bg-orange-100 text-orange-700 border border-orange-200'
          }`}
        >
          {role === 'operator' ? <UserIcon size={14} /> : <Briefcase size={14} />}
          {role === 'operator' ? 'OPERATOR' : 'TIGER'}
        </button>
      </header>

      {/* Main Content Area */}
      <main className="max-w-md mx-auto p-4">
        
        {view === 'list' && (
          <div className="space-y-4">
            <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
               <div className="min-w-[100px] bg-white p-3 rounded-xl border border-slate-100 shadow-sm">
                 <div className="text-slate-400 text-xs font-medium uppercase">Pending</div>
                 <div className="text-2xl font-bold text-slate-700">
                   {sites.filter(s => ['lead', 'checklist_done', 'submitted', 'visit_proposed', 'visit_confirmed', 'tech_visit'].includes(s.status)).length}
                 </div>
               </div>
               <div className="min-w-[100px] bg-white p-3 rounded-xl border border-slate-100 shadow-sm">
                 <div className="text-slate-400 text-xs font-medium uppercase">Approved</div>
                 <div className="text-2xl font-bold text-green-600">
                   {sites.filter(s => s.status === 'approved' || s.status === 'operational').length}
                 </div>
               </div>
            </div>

            <div className="space-y-3">
              {sites.map(site => (
                <Card 
                  key={site.id} 
                  onClick={() => { setSelectedSite(site); setView('detail'); }}
                  onLongPress={() => handleDeleteSite(site.id, site.siteId)}
                >
                  <div className="flex justify-between items-start mb-2">
                    <span className="font-mono text-xs font-bold text-slate-400">{site.siteId}</span>
                    <StatusBadge status={site.status} />
                  </div>
                  <h3 className="font-bold text-slate-800 text-lg leading-tight mb-1">{site.name}</h3>
                  <div className="flex items-center gap-1.5 text-slate-500 text-sm">
                    <MapPin size={14} />
                    <span className="truncate">{site.address}</span>
                  </div>
                </Card>
              ))}
              {sites.length === 0 && (
                <div className="text-center py-10 text-slate-400">
                  <p>No sites found.</p>
                  {role === 'operator' && <p className="text-sm mt-2">Tap + to add one.</p>}
                </div>
              )}
            </div>
          </div>
        )}

        {view === 'create' && (
          <CreateSiteForm 
            onCancel={() => setView('list')} 
            onSubmit={handleCreateSite} 
          />
        )}

        {view === 'detail' && selectedSite && (
          <SiteDetailView 
            site={selectedSite} 
            role={role} 
            onUpdateStatus={updateStatus}
          />
        )}
      </main>

      {/* FAB - Operator Only */}
      {view === 'list' && role === 'operator' && (
        <button 
          onClick={() => setView('create')}
          className="fixed bottom-6 right-6 bg-blue-600 text-white w-14 h-14 rounded-full shadow-lg shadow-blue-600/30 flex items-center justify-center active:scale-90 transition-transform"
        >
          <Plus size={28} />
        </button>
      )}
    </div>
  );
}

// --- Sub-Components for Views ---

function CreateSiteForm({ onCancel, onSubmit }: { onCancel: () => void, onSubmit: (d: any) => void }) {
  const [formData, setFormData] = useState({
    siteId: '',
    name: '',
    address: '',
    ownerName: '',
    ownerPhone: ''
  });

  const generateId = () => {
    const randomNum = Math.floor(100 + Math.random() * 900);
    setFormData(p => ({ ...p, siteId: `DHK-GEN-${randomNum}` }));
  };

  return (
    <div className="space-y-6">
      <Card className="space-y-4">
        <h2 className="font-bold text-lg text-slate-800">Stage A: Lead Identification</h2>
        
        <div>
          <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Site ID</label>
          <div className="flex gap-2">
            <input 
              value={formData.siteId}
              onChange={e => setFormData({...formData, siteId: e.target.value})}
              placeholder="DISTRICT-THANA-###"
              className="flex-1 border border-slate-300 rounded-lg px-3 py-2 font-mono text-sm"
            />
            <button onClick={generateId} type="button" className="text-xs bg-slate-100 px-3 rounded-lg font-bold text-slate-600">
              Auto
            </button>
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Site Name</label>
          <input 
            value={formData.name}
            onChange={e => setFormData({...formData, name: e.target.value})}
            className="w-full border border-slate-300 rounded-lg px-3 py-2"
            placeholder="e.g. Rahim's Garage"
          />
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Address</label>
          <textarea 
            value={formData.address}
            onChange={e => setFormData({...formData, address: e.target.value})}
            className="w-full border border-slate-300 rounded-lg px-3 py-2"
            rows={2}
          />
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Owner Details</label>
          <input 
            value={formData.ownerName}
            onChange={e => setFormData({...formData, ownerName: e.target.value})}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 mb-2"
            placeholder="Name"
          />
          <input 
            value={formData.ownerPhone}
            onChange={e => setFormData({...formData, ownerPhone: e.target.value})}
            className="w-full border border-slate-300 rounded-lg px-3 py-2"
            placeholder="Phone"
            type="tel"
          />
        </div>
      </Card>

      <div className="flex gap-3">
        <button onClick={onCancel} className="flex-1 py-3 bg-white border border-slate-300 text-slate-600 font-bold rounded-xl">Cancel</button>
        <button 
          onClick={() => onSubmit(formData)}
          disabled={!formData.siteId || !formData.name}
          className="flex-1 py-3 bg-blue-600 text-white font-bold rounded-xl disabled:opacity-50 shadow-lg shadow-blue-600/20"
        >
          Create Lead
        </button>
      </div>
    </div>
  );
}

function SiteDetailView({ site, role, onUpdateStatus }: { site: SiteData, role: Role, onUpdateStatus: any }) {
  const [scheduleDate, setScheduleDate] = useState('');
  const [showChecklist, setShowChecklist] = useState(false);
  
  // Tech Assessment Form State
  const [techForm, setTechForm] = useState(site.techAssessment || {
    electrical: false, ventilation: false, connectivity: false, risks: '', preconditions: ''
  });
  
  // States for Installation Proposal
  const [installDate, setInstallDate] = useState('');
  const [picName, setPicName] = useState('');
  const [picPhone, setPicPhone] = useState('');

  // States for Deployment (New SOP)
  const [deployData, setDeployData] = useState({
    cabinetSerial: '',
    batteryCount: '',
    dashboardId: '',
    checkCabinet: false,
    checkDashboard: false
  });

  // Helper to Copy Text
  const copyToClipboard = (text: string) => {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand("copy"); 
    document.body.removeChild(textArea);
    alert("Report copied to clipboard!");
  };

  const handleProposeVisit = () => {
    if(!scheduleDate) return alert("Please select a date and time");
    onUpdateStatus(site.id, 'visit_proposed', { visitDate: scheduleDate });
  };

  // Submit Tech Assessment
  const handleSubmitTechAssessment = () => {
    onUpdateStatus(site.id, 'decision_pending', { techAssessment: techForm });
  };

  // Handle Decision (Go/No-Go)
  const handleDecision = (result: 'GO' | 'NO-GO' | 'DEFER') => {
     let status: SiteStatus = result === 'GO' ? 'approved' : result === 'NO-GO' ? 'rejected' : 'deferred';
     onUpdateStatus(site.id, status, { 
      decision: { 
        result, 
        notes: '', 
        targetDate: '3-7 days' 
      } 
    });
  };

  // Handle Install Proposal
  const handleProposeInstall = () => {
    if(!installDate || !picName || !picPhone) return alert("Please fill all fields");
    onUpdateStatus(site.id, 'install_proposed', {
      installation: {
        date: installDate,
        picName,
        picPhone
      }
    });
  };

  // NEW: Handle Deployment Confirmation
  const handleDeployment = () => {
    if (!deployData.cabinetSerial || !deployData.batteryCount || !deployData.dashboardId) {
      return alert("Please fill in all deployment details.");
    }
    if (!deployData.checkCabinet || !deployData.checkDashboard) {
      return alert("Please check both confirmation boxes.");
    }

    onUpdateStatus(site.id, 'operational', {
      deployment: {
        cabinetSerial: deployData.cabinetSerial,
        batteryCount: deployData.batteryCount,
        dashboardId: deployData.dashboardId,
        deployedAt: new Date().toISOString()
      }
    });
  };

  // --- Renders ---
  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-20">
      
      {/* 1. Status Tracker */}
      <div className="flex items-center justify-between px-2">
        <Step active={true} label="Lead" icon={MapPin} />
        <div className="h-0.5 flex-1 bg-slate-200 mx-1" />
        <Step active={['submitted', 'visit_proposed', 'visit_confirmed', 'tech_visit', 'decision_pending', 'approved', 'install_proposed', 'install_confirmed', 'contract_ready', 'installed', 'operational'].includes(site.status)} label="Check" icon={CheckSquare} />
        <div className="h-0.5 flex-1 bg-slate-200 mx-1" />
        <Step active={['approved', 'install_proposed', 'install_confirmed', 'contract_ready', 'installed', 'operational'].includes(site.status)} label="Go" icon={CheckCircle} />
        <div className="h-0.5 flex-1 bg-slate-200 mx-1" />
        <Step active={['installed', 'operational'].includes(site.status)} label="Live" icon={Zap} />
      </div>

      {/* 2. Site Info Card */}
      <Card>
        <div className="flex justify-between items-start">
            <div>
                <h2 className="text-xl font-bold text-slate-800">{site.name}</h2>
                <div className="text-slate-500 text-sm mt-1">{site.address}</div>
                <div className="text-slate-500 text-sm mt-1 flex items-center gap-1">
                    <UserIcon size={12}/> {site.ownerName} • {site.ownerPhone}
                </div>
            </div>
            <StatusBadge status={site.status} />
        </div>
      </Card>

      {/* NEW: Floating "View Checklist Data" Button */}
      {site.checklist && (
        <>
          <button 
            onClick={() => setShowChecklist(true)}
            className="fixed bottom-24 right-4 bg-white border border-slate-200 text-slate-700 px-4 py-2 rounded-full shadow-lg font-bold flex items-center gap-2 z-20"
          >
            <ClipboardList size={18} /> 📋 Site Data
          </button>

          {/* Slide-over Drawer for Checklist View */}
          {showChecklist && (
            <div className="fixed inset-0 z-50 flex justify-end">
               <div className="absolute inset-0 bg-black/50" onClick={() => setShowChecklist(false)} />
               <div className="relative w-full max-w-md bg-white h-full shadow-2xl overflow-y-auto animate-in slide-in-from-right duration-300">
                  <div className="sticky top-0 bg-white p-4 border-b border-slate-100 flex justify-between items-center z-10">
                     <h3 className="font-bold text-slate-800 text-lg">Site Checklist Data</h3>
                     <button onClick={() => setShowChecklist(false)} className="p-2 bg-slate-100 rounded-full"><X size={20}/></button>
                  </div>
                  <div className="p-4">
                     <ReadOnlyChecklist data={site.checklist} siteId={site.id} />
                  </div>
               </div>
            </div>
          )}
        </>
      )}

      {/* --- STAGE B: Operator Detailed Checklist --- */}
      {site.status === 'lead' && role === 'operator' && (
        <ChecklistForm 
          siteId={site.id}
          initialData={site.checklist} 
          onSubmit={(data) => onUpdateStatus(site.id, 'checklist_done', { checklist: data })}
        />
      )}

      {/* --- STAGE C: Submission --- */}
      {site.status === 'checklist_done' && role === 'operator' && (
        <Card>
            <h3 className="font-bold text-slate-800 mb-2">Ready to Submit</h3>
            <p className="text-sm text-slate-500 mb-4">Checklist complete. Share to WhatsApp group to request Tiger visit.</p>
            
            <button 
              onClick={() => copyToClipboard(generateWhatsAppReport(site))}
              className="w-full flex items-center justify-center gap-2 py-3 bg-green-500 text-white font-bold rounded-xl mb-3 shadow-lg shadow-green-500/20"
            >
              <Copy size={18} /> Copy WhatsApp Report
            </button>
            <button 
              onClick={() => onUpdateStatus(site.id, 'submitted')}
              className="w-full py-3 bg-indigo-600 text-white font-bold rounded-xl shadow-lg shadow-indigo-600/20"
            >
              Submit to Tiger
            </button>
        </Card>
      )}

      {/* --- STAGE C.1: Tiger Review & Schedule --- */}
      {site.status === 'submitted' && role === 'tiger' && (
        <div className="space-y-4">
           <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 flex items-start gap-3">
             <div className="bg-blue-100 p-2 rounded-full text-blue-600 mt-1"><Eye size={18}/></div>
             <div>
               <h3 className="font-bold text-blue-900">Review Data</h3>
               <p className="text-xs text-blue-700 mb-2">Click the "📋 Site Data" button below to review photos and details before scheduling.</p>
             </div>
           </div>

           <Card className="border-orange-200 bg-orange-50">
             <h3 className="font-bold text-orange-900 mb-2">Schedule Visit</h3>
             <p className="text-sm text-orange-800 mb-4">If details are okay, propose a time for the visit.</p>
             
             <div className="mb-4">
               <label className="block text-xs font-bold text-orange-700 uppercase mb-1">Visit Date & Time</label>
               <input 
                 type="datetime-local" 
                 value={scheduleDate}
                 onChange={e => setScheduleDate(e.target.value)}
                 className="w-full p-3 rounded-lg border border-orange-200 text-sm focus:ring-orange-500"
               />
             </div>

             <button 
                onClick={handleProposeVisit}
                className="w-full py-3 bg-orange-600 text-white font-bold rounded-xl shadow-lg shadow-orange-600/20"
              >
                Propose Visit Time
              </button>
           </Card>
        </div>
      )}

      {/* --- STAGE C.2: Operator Confirmation --- */}
      {site.status === 'visit_proposed' && (
        <Card className="border-blue-200 bg-blue-50">
          <div className="flex items-start gap-3">
             <div className="bg-blue-200 p-2 rounded-full text-blue-700"><Calendar size={20} /></div>
             <div>
               <h3 className="font-bold text-blue-900">Tiger Proposed Visit</h3>
               <div className="text-2xl font-bold text-blue-800 my-2">
                 {site.visitDate ? new Date(site.visitDate).toLocaleDateString() : 'TBD'} <span className="text-base font-normal">at</span> {site.visitDate ? new Date(site.visitDate).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : ''}
               </div>
               
               {role === 'operator' && (
                 <>
                  <p className="text-sm text-blue-700 mb-4">Please contact the owner to confirm availability.</p>
                  <a href={`tel:${site.ownerPhone}`} className="inline-flex items-center gap-2 px-4 py-2 bg-white text-blue-700 font-bold rounded-lg border border-blue-200 text-sm mb-3">
                    <Phone size={14} /> Call Owner
                  </a>
                  <button 
                    onClick={() => onUpdateStatus(site.id, 'visit_confirmed')}
                    className="w-full py-3 bg-blue-600 text-white font-bold rounded-xl shadow-lg shadow-blue-600/20"
                  >
                    Accept & Confirm Visit
                  </button>
                 </>
               )}

               {role === 'tiger' && (
                 <p className="text-sm text-blue-700 font-bold opacity-70 mt-2">Waiting for Operator to confirm...</p>
               )}
             </div>
          </div>
        </Card>
      )}

      {/* --- STAGE D: Tech Visit Start --- */}
      {site.status === 'visit_confirmed' && role === 'tiger' && (
         <Card className="border-green-200 bg-green-50">
           <div className="flex flex-col items-center text-center py-4">
             <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center text-green-600 mb-3">
               <CheckCircle size={32} />
             </div>
             <h3 className="font-bold text-green-900 text-lg">Visit Confirmed</h3>
             <p className="text-sm text-green-700 mb-6 max-w-[200px]">Operator has confirmed the date with the owner.</p>
             <button 
                onClick={() => onUpdateStatus(site.id, 'tech_visit')}
                className="w-full py-3 bg-green-600 text-white font-bold rounded-xl shadow-lg shadow-green-600/20"
              >
                Start Tech Visit
              </button>
           </div>
         </Card>
      )}

      {/* --- STAGE D: Tech Form --- */}
      {site.status === 'tech_visit' && role === 'tiger' && (
         <Card className="border-purple-100 bg-purple-50">
            <h3 className="font-bold text-purple-900 mb-4">Tech Assessment</h3>
            
            <div className="space-y-3 mb-4">
              {[
                { k: 'electrical', l: 'Electrical Feasibility (3-Phase/Grounding)' },
                { k: 'ventilation', l: 'Layout & Ventilation Safe' },
                { k: 'connectivity', l: 'Network Connectivity OK' },
              ].map(item => (
                <label key={item.k} className="flex items-center gap-3 bg-white p-3 rounded-lg border border-purple-200">
                  <input 
                    type="checkbox" 
                    checked={(techForm as any)[item.k]}
                    onChange={e => setTechForm({...techForm, [item.k]: e.target.checked})}
                    className="w-5 h-5 rounded border-purple-300 text-purple-600 focus:ring-purple-500"
                  />
                  <span className="text-sm font-medium text-purple-900">{item.l}</span>
                </label>
              ))}
              
              <div className="bg-white p-3 rounded-lg border border-purple-200">
                 <div className="text-xs font-bold text-purple-700 uppercase mb-1">Risks / Civil Work Needed</div>
                 <input 
                  value={techForm.risks} 
                  onChange={e => setTechForm({...techForm, risks: e.target.value})}
                  className="w-full text-sm outline-none" 
                  placeholder="e.g. Needs concrete platform"
                 />
              </div>

              <div className="bg-white p-3 rounded-lg border border-red-200">
                 <div className="text-xs font-bold text-red-700 uppercase mb-1 flex items-center gap-1">
                    <AlertTriangle size={12}/> Pre-conditions for GO
                 </div>
                 <textarea 
                  value={techForm.preconditions} 
                  onChange={e => setTechForm({...techForm, preconditions: e.target.value})}
                  className="w-full text-sm outline-none resize-none" 
                  placeholder="List conditions that MUST be met before install..."
                  rows={2}
                 />
              </div>
            </div>

            <button 
              onClick={handleSubmitTechAssessment}
              className="w-full py-3 bg-purple-600 text-white font-bold rounded-xl"
            >
              Complete Assessment
            </button>
         </Card>
      )}

      {/* --- STAGE E: Tiger Decision Pending --- */}
      {site.status === 'decision_pending' && role === 'tiger' && (
         <Card className="text-center">
            <h3 className="font-bold text-slate-800 mb-4">Assessment & Decision</h3>
            <div className="grid grid-cols-3 gap-3">
              <button onClick={() => handleDecision('GO')} className="py-4 bg-green-100 text-green-700 font-bold rounded-xl border border-green-200 hover:bg-green-200">GO ✅</button>
              <button onClick={() => handleDecision('NO-GO')} className="py-4 bg-red-100 text-red-700 font-bold rounded-xl border border-red-200 hover:bg-red-200">NO ❌</button>
              <button onClick={() => handleDecision('DEFER')} className="py-4 bg-yellow-100 text-yellow-700 font-bold rounded-xl border border-yellow-200 hover:bg-yellow-200">DEFER ⏸️</button>
            </div>
         </Card>
      )}

      {/* --- STAGE F: Post-Decision Workflow (Approved / Rejected) --- */}
      {(['approved', 'rejected', 'deferred'].includes(site.status)) && (
        <div className="space-y-4">
           
           {/* Decision Report Card (For WhatsApp) */}
           <Card className={`border-l-4 ${site.status === 'approved' ? 'border-l-green-500' : 'border-l-red-500'}`}>
              <div className="flex justify-between items-start mb-2">
                 <h3 className="font-bold text-slate-800">Decision: {site.status.toUpperCase()}</h3>
                 <button 
                   onClick={() => copyToClipboard(generateDecisionReport(site))}
                   className="text-xs bg-slate-100 px-3 py-1.5 rounded-lg font-bold text-slate-600 flex items-center gap-1 hover:bg-slate-200"
                 >
                   <Copy size={12} /> Copy Report
                 </button>
              </div>
              <p className="text-sm text-slate-500">Copy this report to the WhatsApp group.</p>
           </Card>

           {/* --- Installation Scheduling (Approved Only) --- */}
           {site.status === 'approved' && role === 'tiger' && (
             <Card className="border-teal-200 bg-teal-50">
               <h3 className="font-bold text-teal-900 mb-4 flex items-center gap-2">
                 <Truck size={18} /> Schedule Installation
               </h3>
               
               <div className="space-y-3">
                 <div>
                   <label className="block text-xs font-bold text-teal-700 uppercase mb-1">Install Date & Time</label>
                   <input type="datetime-local" value={installDate} onChange={e => setInstallDate(e.target.value)} className="w-full p-2.5 rounded-lg border border-teal-200 text-sm" />
                 </div>
                 <div>
                   <label className="block text-xs font-bold text-teal-700 uppercase mb-1">Person in Charge (PIC)</label>
                   <input placeholder="Tiger Name" value={picName} onChange={e => setPicName(e.target.value)} className="w-full p-2.5 rounded-lg border border-teal-200 text-sm" />
                 </div>
                 <div>
                   <label className="block text-xs font-bold text-teal-700 uppercase mb-1">PIC Phone Number</label>
                   <input placeholder="017..." value={picPhone} onChange={e => setPicPhone(e.target.value)} className="w-full p-2.5 rounded-lg border border-teal-200 text-sm" />
                 </div>
                 
                 <button 
                   onClick={handleProposeInstall}
                   className="w-full py-3 bg-teal-600 text-white font-bold rounded-xl shadow-lg shadow-teal-600/20"
                 >
                   Propose Installation
                 </button>
               </div>
             </Card>
           )}

           {/* Operator Waiting View */}
           {site.status === 'approved' && role === 'operator' && (
             <Card className="text-center py-6 bg-slate-50 border-slate-100">
               <Clock className="w-8 h-8 text-slate-300 mx-auto mb-2" />
               <p className="text-sm text-slate-500 font-bold">Waiting for Tiger to schedule installation...</p>
             </Card>
           )}
        </div>
      )}

      {/* --- STAGE F.2: Operator Confirms Install --- */}
      {site.status === 'install_proposed' && (
         <Card className="border-teal-200 bg-teal-50">
            <h3 className="font-bold text-teal-900 mb-2 flex items-center gap-2">
               <Calendar size={18} /> Installation Proposed
            </h3>
            
            <div className="bg-white/60 rounded-lg p-3 text-sm text-teal-800 space-y-2 mb-4">
               <p><span className="font-bold">Date:</span> {new Date(site.installation!.date).toLocaleString()}</p>
               <p><span className="font-bold">PIC:</span> {site.installation!.picName}</p>
               <p><span className="font-bold">Phone:</span> {site.installation!.picPhone}</p>
            </div>

            {role === 'operator' && (
              <>
                 <p className="text-sm text-teal-700 mb-4">Confirm this time with the garage owner.</p>
                 <button 
                   onClick={() => onUpdateStatus(site.id, 'install_confirmed')}
                   className="w-full py-3 bg-teal-600 text-white font-bold rounded-xl shadow-lg shadow-teal-600/20"
                 >
                   Confirm Installation
                 </button>
              </>
            )}
            
            {role === 'tiger' && <p className="text-sm text-teal-700 font-bold opacity-70">Waiting for Operator confirmation...</p>}
         </Card>
      )}

      {/* --- STAGE F.3: Installation Summary Page (CONFIRMED) --- */}
      {['install_confirmed', 'contract_ready', 'installed', 'operational'].includes(site.status) && (
        <div className="space-y-4">
           {/* SUMMARY CARD */}
           <Card className="border-indigo-200 bg-indigo-50">
              <div className="flex items-center gap-2 mb-4 border-b border-indigo-200 pb-3">
                 <ClipboardList className="text-indigo-600" />
                 <h3 className="font-bold text-indigo-900 text-lg">Deployment Summary</h3>
              </div>
              
              <div className="grid gap-4 text-sm">
                 <div className="grid grid-cols-2 gap-4">
                    <div>
                       <div className="text-xs font-bold text-indigo-400 uppercase mb-1">Site</div>
                       <div className="font-bold text-indigo-900">{site.name}</div>
                       <div className="text-indigo-700 text-xs">{site.address}</div>
                    </div>
                    <div>
                       <div className="text-xs font-bold text-indigo-400 uppercase mb-1">Owner</div>
                       <div className="font-bold text-indigo-900">{site.ownerName}</div>
                       <div className="text-indigo-700 text-xs">{site.ownerPhone}</div>
                    </div>
                 </div>

                 {/* Technical Context for Installer */}
                 <div className="bg-white/60 p-3 rounded-lg border border-indigo-100">
                    <div className="text-xs font-bold text-indigo-400 uppercase mb-2">Technical Context</div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <span className="text-indigo-500">Power:</span> <span className="font-bold text-indigo-900">{site.checklist?.threePhase === 'Yes' ? '3-Phase' : '1-Phase'}</span>
                        </div>
                        <div>
                           <span className="text-indigo-500">Line:</span> <span className="font-bold text-indigo-900">{site.checklist?.lineType}</span>
                        </div>
                        <div>
                           <span className="text-indigo-500">Placement:</span> <span className="font-bold text-indigo-900">{site.checklist?.rainProtection || 'N/A'}</span>
                        </div>
                        <div>
                           <span className="text-indigo-500">Network:</span> <span className="font-bold text-indigo-900">{site.checklist?.network || 'N/A'}</span>
                        </div>
                    </div>
                    {site.techAssessment?.preconditions && (
                      <div className="mt-2 pt-2 border-t border-indigo-100">
                         <span className="text-indigo-500 block mb-1">Conditions to Check:</span>
                         <span className="font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded">{site.techAssessment.preconditions}</span>
                      </div>
                    )}
                 </div>

                 <div className="bg-indigo-100/50 p-3 rounded-lg border border-indigo-100">
                    <div className="text-xs font-bold text-indigo-400 uppercase mb-2">Logistics</div>
                    <div className="flex justify-between items-center mb-1">
                       <span className="text-indigo-600">Install Date:</span>
                       <span className="font-bold text-indigo-900">{new Date(site.installation?.date || '').toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between items-center mb-1">
                       <span className="text-indigo-600">Tiger PIC:</span>
                       <span className="font-bold text-indigo-900">{site.installation?.picName}</span>
                    </div>
                    <div className="flex justify-between items-center">
                       <span className="text-indigo-600">Contact:</span>
                       <span className="font-bold text-indigo-900">{site.installation?.picPhone}</span>
                    </div>
                 </div>
              </div>
           </Card>

           {/* Next Steps Buttons */}
           {site.status === 'install_confirmed' && (
             <div className="flex flex-col gap-2">
                {role === 'operator' && (
                  <button onClick={() => onUpdateStatus(site.id, 'contract_ready')} className="py-3 bg-white border border-slate-200 text-slate-600 font-bold rounded-xl">
                    Mark Contract Draft Ready
                  </button>
                )}
                {role === 'tiger' && (
                   <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 text-center text-sm text-slate-500 italic">
                      Waiting for Operator to prepare contract...
                   </div>
                )}
             </div>
           )}

           {/* --- STAGE H: Deployment & Activation (Tiger) --- */}
           {site.status === 'contract_ready' && role === 'tiger' && (
             <Card className="border-indigo-200 bg-indigo-50">
               <h3 className="font-bold text-indigo-900 mb-4 flex items-center gap-2">
                 <Server size={18} /> Deployment & Activation
               </h3>
               
               <div className="space-y-3">
                 <div>
                   <label className="block text-xs font-bold text-indigo-700 uppercase mb-1">Cabinet Serial Number</label>
                   <input 
                      placeholder="e.g. SN-8821..." 
                      value={deployData.cabinetSerial} 
                      onChange={e => setDeployData({...deployData, cabinetSerial: e.target.value})} 
                      className="w-full p-2.5 rounded-lg border border-indigo-200 text-sm" 
                   />
                 </div>
                 <div>
                   <label className="block text-xs font-bold text-indigo-700 uppercase mb-1">Battery Count Deployed</label>
                   <input 
                      type="number"
                      placeholder="e.g. 12" 
                      value={deployData.batteryCount} 
                      onChange={e => setDeployData({...deployData, batteryCount: e.target.value})} 
                      className="w-full p-2.5 rounded-lg border border-indigo-200 text-sm" 
                   />
                 </div>
                 <div>
                   <label className="block text-xs font-bold text-indigo-700 uppercase mb-1">Dashboard Site ID</label>
                   <input 
                      placeholder="e.g. DASH-001" 
                      value={deployData.dashboardId} 
                      onChange={e => setDeployData({...deployData, dashboardId: e.target.value})} 
                      className="w-full p-2.5 rounded-lg border border-indigo-200 text-sm" 
                   />
                 </div>

                 <div className="pt-2 space-y-2">
                    <label className="flex items-center gap-3 bg-white p-2 rounded-lg border border-indigo-100">
                      <input 
                        type="checkbox" 
                        checked={deployData.checkCabinet}
                        onChange={e => setDeployData({...deployData, checkCabinet: e.target.checked})}
                        className="w-5 h-5 text-indigo-600"
                      />
                      <span className="text-sm font-medium text-indigo-900">Cabinet physically installed</span>
                    </label>
                    <label className="flex items-center gap-3 bg-white p-2 rounded-lg border border-indigo-100">
                      <input 
                        type="checkbox" 
                        checked={deployData.checkDashboard}
                        onChange={e => setDeployData({...deployData, checkDashboard: e.target.checked})}
                        className="w-5 h-5 text-indigo-600"
                      />
                      <span className="text-sm font-medium text-indigo-900">Verified visible on Dashboard</span>
                    </label>
                 </div>
                 
                 <button 
                   onClick={handleDeployment}
                   className="w-full py-3 bg-indigo-600 text-white font-bold rounded-xl shadow-lg shadow-indigo-600/20"
                 >
                   Confirm Deployment & Go Live
                 </button>
               </div>
             </Card>
           )}

            {/* Operator Waiting View for Activation */}
           {site.status === 'contract_ready' && role === 'operator' && (
             <Card className="text-center py-6 bg-slate-50 border-slate-100">
               <Server className="w-8 h-8 text-slate-300 mx-auto mb-2" />
               <p className="text-sm text-slate-500 font-bold">Contract ready. Waiting for Tiger to deploy & activate...</p>
             </Card>
           )}

           {/* --- STAGE I: Operational Success --- */}
           {site.status === 'operational' && (
             <Card className="border-emerald-200 bg-emerald-50 text-center py-8">
                <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-600 mx-auto mb-3">
                   <Zap size={32} fill="currentColor" />
                </div>
                <h2 className="text-2xl font-bold text-emerald-900 mb-1">Site is LIVE</h2>
                <p className="text-emerald-700 text-sm mb-4">Operations have started.</p>
                <div className="inline-block text-left bg-white p-4 rounded-xl shadow-sm border border-emerald-100 text-sm text-slate-600">
                   <p><span className="font-bold text-slate-800">Serial:</span> {site.deployment?.cabinetSerial}</p>
                   <p><span className="font-bold text-slate-800">Dashboard ID:</span> {site.deployment?.dashboardId}</p>
                   <p><span className="font-bold text-slate-800">Batteries:</span> {site.deployment?.batteryCount}</p>
                   <p className="text-xs text-slate-400 mt-2">Activated: {site.deployment?.deployedAt ? new Date(site.deployment.deployedAt).toLocaleDateString() : '-'}</p>
                </div>
             </Card>
           )}

        </div>
      )}

    </div>
  );
}

// --- NEW Read Only Checklist Component for Tiger ---
function ReadOnlyChecklist({ data, siteId }: { data: ChecklistData, siteId: string }) {
  const [openSection, setOpenSection] = useState<number>(0);
  const [photos, setPhotos] = useState<PhotoData[]>([]);
  const toggle = (i: number) => setOpenSection(openSection === i ? 0 : i);

  // Fetch photos for read-only view
  useEffect(() => {
    if(!siteId) return;
    const q = query(collection(db, 'artifacts', APP_ID, 'public', 'data', 'photos'), where('siteId', '==', siteId));
    const unsub = onSnapshot(q, (snap) => {
      setPhotos(snap.docs.map(d => ({ id: d.id, ...d.data() } as PhotoData)));
    });
    return () => unsub();
  }, [siteId]);

  const getPhotosByCategory = (cat: string) => photos.filter(p => p.category === cat);

  return (
    <div className="space-y-2 mb-6">
      <Card className="!p-0 overflow-hidden">
         <SectionHeader title="1. Basic Info & Photos" isOpen={openSection === 1} toggle={() => toggle(1)} />
         {openSection === 1 && <div className="p-4 bg-slate-50 border-t border-slate-100">
            <ReadOnlyField label="Site Type" value={data.siteType} />
            <ReadOnlyField label="Ownership Proof" value={data.ownershipProof} />
            <ReadOnlyField label="GPS Location" value={data.gpsCoordinates} />
            
            <div className="mt-4">
               <div className="text-xs font-bold text-slate-400 uppercase mb-2">Captured Photos</div>
               {photos.length === 0 ? <div className="text-xs text-slate-400 italic">No photos uploaded.</div> : (
                 <div className="grid grid-cols-2 gap-2">
                   {photos.map(p => (
                     <div key={p.id} className="relative group">
                        <img src={p.base64} alt={p.category} className="w-full h-24 object-cover rounded-lg border border-slate-200" />
                        <span className="absolute bottom-1 left-1 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded">{p.category}</span>
                     </div>
                   ))}
                 </div>
               )}
            </div>
         </div>}
      </Card>
      
      <Card className="!p-0 overflow-hidden">
         <SectionHeader title="2. Riders & Demand" isOpen={openSection === 2} toggle={() => toggle(2)} />
         {openSection === 2 && <div className="p-4 bg-slate-50 border-t border-slate-100">
            <ReadOnlyField label="Rider Types" value={data.riderType.join(', ')} />
            <ReadOnlyField label="Avg Income" value={data.avgIncome} />
            <ReadOnlyField label="Riders in Area" value={data.ridersInArea} />
            <ReadOnlyField label="Riders in Garage" value={data.ridersInGarage} />
         </div>}
      </Card>

      <Card className="!p-0 overflow-hidden">
         <SectionHeader title="3. Road Access" isOpen={openSection === 3} toggle={() => toggle(3)} />
         {openSection === 3 && <div className="p-4 bg-slate-50 border-t border-slate-100">
            <ReadOnlyField label="Main Roads" value={data.mainRoadAccessible} />
            <ReadOnlyField label="Time Restrictions" value={data.timeRestrictions} />
            <ReadOnlyField label="Permits" value={data.permitsRequired} />
            <ReadOnlyField label="Notes" value={data.roadNotes} />
         </div>}
      </Card>

      <Card className="!p-0 overflow-hidden">
         <SectionHeader title="4. Flood Risk" isOpen={openSection === 4} toggle={() => toggle(4)} />
         {openSection === 4 && <div className="p-4 bg-slate-50 border-t border-slate-100">
            <ReadOnlyField label="No Frequent Flooding" value={data.noFloodHistory} />
            <ReadOnlyField label="Not Low-Lying" value={data.notLowLying} />
            <ReadOnlyField label="Evidence" value={data.floodEvidence} />
         </div>}
      </Card>

      <Card className="!p-0 overflow-hidden">
         <SectionHeader title="5. Tech & Power" isOpen={openSection === 5} toggle={() => toggle(5)} />
         {openSection === 5 && <div className="p-4 bg-slate-50 border-t border-slate-100">
            <ReadOnlyField label="Line Type" value={data.lineType} />
            <ReadOnlyField label="3-Phase" value={data.threePhase} />
            <ReadOnlyField label="Available Load (kW)" value={data.capacityLoad} />
            <ReadOnlyField label="Grounding" value={data.grounding} />
            <ReadOnlyField label="Point ID" value={data.pointIdentified} />
            <ReadOnlyField label="Meter Pic" value={data.meterPic} />
         </div>}
      </Card>

      <Card className="!p-0 overflow-hidden">
         <SectionHeader title="6. Reliability" isOpen={openSection === 6} toggle={() => toggle(6)} />
         {openSection === 6 && <div className="p-4 bg-slate-50 border-t border-slate-100">
            <ReadOnlyField label="No Freq Outages" value={data.noFrequentOutages} />
            <ReadOnlyField label="Outage Freq" value={data.outageFreq} />
            <ReadOnlyField label="Outage Dur" value={data.outageDur} />
            <ReadOnlyField label="Load Shedding" value={data.loadShedding} />
         </div>}
      </Card>

      <Card className="!p-0 overflow-hidden">
         <SectionHeader title="7. Install & Security" isOpen={openSection === 7} toggle={() => toggle(7)} />
         {openSection === 7 && <div className="p-4 bg-slate-50 border-t border-slate-100">
            <ReadOnlyField label="Ventilation" value={data.spaceVentilation} />
            <ReadOnlyField label="Rain Protection" value={data.rainProtection} />
            <ReadOnlyField label="Network" value={data.network} />
            <ReadOnlyField label="Security" value={data.security.join(', ')} />
         </div>}
      </Card>
      
      <Card className="!p-0 overflow-hidden">
         <SectionHeader title="8. Commercial" isOpen={openSection === 8} toggle={() => toggle(8)} />
         {openSection === 8 && <div className="p-4 bg-slate-50 border-t border-slate-100">
            <ReadOnlyField label="Owner Willing" value={data.ownerWilling} />
            <ReadOnlyField label="Model" value={data.collabModel} />
            <ReadOnlyField label="User Readiness" value={data.userReadiness} />
            <ReadOnlyField label="Benefit Understood" value={data.benefitUnderstood} />
            <ReadOnlyField label="Concerns" value={data.concerns} />
         </div>}
      </Card>
    </div>
  );
}

function ChecklistForm({ initialData, siteId, onSubmit }: { initialData?: ChecklistData, siteId: string, onSubmit: (d: ChecklistData) => void }) {
  const [data, setData] = useState<ChecklistData>(initialData || {
    siteType: 'Workshop',
    ownershipProof: 'Pending',
    gpsCoordinates: '', // Init GPS
    photosTaken: { front: false, entrance: false, installSpot: false, meter: false, roads: false, additional: 0 },
    riderType: [],
    avgIncome: '',
    ridersInArea: '',
    ridersInGarage: '',
    mainRoadAccessible: '',
    timeRestrictions: '',
    permitsRequired: '',
    roadNotes: '',
    noFloodHistory: '',
    notLowLying: '',
    floodEvidence: 'Photo',
    lineType: 'LTD3',
    threePhase: '',
    capacityLoad: '',
    grounding: '',
    pointIdentified: '',
    meterPic: '',
    noFrequentOutages: '',
    outageFreq: '',
    outageDur: '',
    loadShedding: '',
    spaceVentilation: '',
    rainProtection: 'Indoor',
    network: '4G',
    security: [],
    ownerWilling: '',
    collabModel: 'Purchase',
    userReadiness: '',
    benefitUnderstood: '',
    concerns: ''
  });

  const [openSection, setOpenSection] = useState<number>(1);
  const toggleSection = (i: number) => setOpenSection(openSection === i ? 0 : i);

  // New: GPS Handling
  const [loadingLoc, setLoadingLoc] = useState(false);
  const handleGetLocation = () => {
    if (!navigator.geolocation) {
      alert("Geolocation is not supported by your browser");
      return;
    }
    setLoadingLoc(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const coords = `${position.coords.latitude.toFixed(6)}, ${position.coords.longitude.toFixed(6)}`;
        setData({...data, gpsCoordinates: coords});
        setLoadingLoc(false);
      },
      () => {
        alert("Unable to retrieve your location. Please check browser permissions.");
        setLoadingLoc(false);
      }
    );
  };

  const handleCopyGPS = () => {
    if (!data.gpsCoordinates) return;
    const textArea = document.createElement("textarea");
    textArea.value = data.gpsCoordinates;
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand("copy");
    document.body.removeChild(textArea);
    alert("GPS copied!");
  }

  // Update parent state when a photo is uploaded
  const handlePhotoUploaded = (category: string) => {
    if (category.startsWith('Additional')) {
       setData(prev => ({ ...prev, photosTaken: { ...prev.photosTaken, additional: prev.photosTaken.additional + 1 } }));
    } else {
       const key = category.toLowerCase().replace(/\s/g, '') as keyof typeof data.photosTaken;
       // We map 'Front' -> 'front', 'Install Spot' -> 'installspot' etc. need to match keys
       // Simplification: We just use the known keys
       let keyName = '';
       if (category === 'Front') keyName = 'front';
       if (category === 'Entrance') keyName = 'entrance';
       if (category === 'Install Spot') keyName = 'installSpot';
       if (category === 'Meter') keyName = 'meter';
       if (category === 'Roads') keyName = 'roads';
       
       if (keyName) {
         setData(prev => ({ ...prev, photosTaken: { ...prev.photosTaken, [keyName]: true } }));
       }
    }
  };

  return (
    <div className="space-y-4 pb-20">
      <h3 className="text-lg font-bold text-slate-800 px-1">Site Assessment Checklist</h3>
      {/* 1. Basic Info */}
      <Card>
        <SectionHeader title="1. Basic Info & Photos" isOpen={openSection === 1} toggle={() => toggleSection(1)} />
        {openSection === 1 && (
          <div className="animate-in fade-in slide-in-from-top-2 pt-2">
            <RadioGroup 
              label="Site Type" 
              options={['Workshop', 'Fleet', 'Parking', 'Market', 'Other']}
              value={data.siteType}
              onChange={(v) => setData({...data, siteType: v})}
            />
            <RadioGroup 
              label="Ownership Proof Available?" 
              options={['Yes', 'No', 'Pending']}
              value={data.ownershipProof}
              onChange={(v) => setData({...data, ownershipProof: v as any})}
            />
            
            {/* New GPS Section */}
            <div className="mb-4">
               <div className="text-xs font-bold text-slate-500 uppercase mb-1">GPS Location</div>
               <div className="flex gap-2">
                 <input 
                   readOnly
                   value={data.gpsCoordinates}
                   placeholder="Lat, Long"
                   className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm bg-slate-50 text-slate-600"
                 />
                 <button 
                   onClick={handleGetLocation} 
                   disabled={loadingLoc}
                   className="bg-blue-600 text-white px-3 py-2 rounded-lg flex items-center justify-center disabled:opacity-50"
                 >
                   {loadingLoc ? <Activity className="animate-spin w-4 h-4"/> : <Locate size={18} />}
                 </button>
                 <button 
                   onClick={handleCopyGPS}
                   disabled={!data.gpsCoordinates}
                   className="bg-slate-100 text-slate-600 border border-slate-200 px-3 py-2 rounded-lg disabled:opacity-50"
                 >
                   <Copy size={18} />
                 </button>
               </div>
            </div>

            <div className="mt-4">
               <div className="text-xs font-bold text-slate-500 uppercase mb-3">Required Photos</div>
               <div className="grid grid-cols-2 gap-3">
                  <PhotoCapture label="Front View" category="Front" siteId={siteId} onPhotoTaken={() => handlePhotoUploaded('Front')} />
                  <PhotoCapture label="Entrance" category="Entrance" siteId={siteId} onPhotoTaken={() => handlePhotoUploaded('Entrance')} />
                  <PhotoCapture label="Install Spot" category="Install Spot" siteId={siteId} onPhotoTaken={() => handlePhotoUploaded('Install Spot')} />
                  <PhotoCapture label="Meter / Panel" category="Meter" siteId={siteId} onPhotoTaken={() => handlePhotoUploaded('Meter')} />
                  <PhotoCapture label="Road Access" category="Roads" siteId={siteId} onPhotoTaken={() => handlePhotoUploaded('Roads')} />
               </div>
               
               <div className="mt-4 pt-4 border-t border-slate-100">
                  <div className="text-xs font-bold text-slate-500 uppercase mb-2">Additional Photos</div>
                  <PhotoCapture label="Extra Photo 1" category="Additional 1" siteId={siteId} onPhotoTaken={() => handlePhotoUploaded('Additional 1')} />
                  {data.photosTaken.additional >= 1 && (
                    <PhotoCapture label="Extra Photo 2" category="Additional 2" siteId={siteId} onPhotoTaken={() => handlePhotoUploaded('Additional 2')} />
                  )}
               </div>
            </div>
            <button onClick={() => setOpenSection(2)} className="w-full mt-4 py-2 bg-slate-100 text-slate-600 font-bold rounded-lg text-sm">Next Section</button>
          </div>
        )}
      </Card>
      
      {/* 2. Riders */}
      <Card>
        <SectionHeader title="2. Riders & Demand" isOpen={openSection === 2} toggle={() => toggleSection(2)} />
        {openSection === 2 && (
          <div className="animate-in fade-in slide-in-from-top-2 pt-2">
             <div className="mb-4">
               <div className="text-xs font-bold text-slate-500 uppercase mb-2">Target Rider Type</div>
               <div className="flex gap-2">
                 {['R3', 'R6', 'R9'].map(r => (
                   <label key={r} className={`px-4 py-2 rounded-lg border cursor-pointer ${data.riderType.includes(r) ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600'}`}>
                     <input type="checkbox" className="hidden" 
                       checked={data.riderType.includes(r)}
                       onChange={e => {
                         if(e.target.checked) setData({...data, riderType: [...data.riderType, r]});
                         else setData({...data, riderType: data.riderType.filter(x => x !== r)});
                       }}
                     />
                     <span className="text-xs font-bold">{r}</span>
                   </label>
                 ))}
               </div>
             </div>
             <InputField label="Avg Daily Income (BDT)" value={data.avgIncome} onChange={(v: string) => setData({...data, avgIncome: v})} type="number"/>
             <div className="grid grid-cols-2 gap-3">
               <InputField label="# Riders in Area" value={data.ridersInArea} onChange={(v: string) => setData({...data, ridersInArea: v})} type="number"/>
               <InputField label="# In Garage" value={data.ridersInGarage} onChange={(v: string) => setData({...data, ridersInGarage: v})} type="number"/>
             </div>
             <button onClick={() => setOpenSection(3)} className="w-full mt-4 py-2 bg-slate-100 text-slate-600 font-bold rounded-lg text-sm">Next Section</button>
          </div>
        )}
      </Card>

      {/* 3. Road Access */}
      <Card>
        <SectionHeader title="3. Road Access" isOpen={openSection === 3} toggle={() => toggleSection(3)} />
        {openSection === 3 && (
          <div className="animate-in fade-in slide-in-from-top-2 pt-2">
            <YesNoSelect label="Main roads freely accessible?" value={data.mainRoadAccessible} onChange={v => setData({...data, mainRoadAccessible: v})}/>
            <YesNoSelect label="Time restrictions exist?" value={data.timeRestrictions} onChange={v => setData({...data, timeRestrictions: v})} options={['Yes', 'No', 'N/A']} />
            <YesNoSelect label="Permits required?" value={data.permitsRequired} onChange={v => setData({...data, permitsRequired: v})} options={['Yes', 'No', 'N/A']} />
            <InputField label="Notes" value={data.roadNotes} onChange={(v: string) => setData({...data, roadNotes: v})}/>
            <button onClick={() => setOpenSection(4)} className="w-full mt-4 py-2 bg-slate-100 text-slate-600 font-bold rounded-lg text-sm">Next Section</button>
          </div>
        )}
      </Card>

      {/* 4. Flood */}
      <Card>
        <SectionHeader title="4. Flood Risk" isOpen={openSection === 4} toggle={() => toggleSection(4)} />
        {openSection === 4 && (
          <div className="animate-in fade-in slide-in-from-top-2 pt-2">
            <YesNoSelect label="No frequent flooding (rainy season)?" value={data.noFloodHistory} onChange={v => setData({...data, noFloodHistory: v})}/>
            <YesNoSelect label="Site NOT in low-lying area?" value={data.notLowLying} onChange={v => setData({...data, notLowLying: v})}/>
            <RadioGroup label="Evidence Type" options={['Photo', 'Merchant', 'Record']} value={data.floodEvidence} onChange={v => setData({...data, floodEvidence: v})}/>
            <button onClick={() => setOpenSection(5)} className="w-full mt-4 py-2 bg-slate-100 text-slate-600 font-bold rounded-lg text-sm">Next Section</button>
          </div>
        )}
      </Card>

      {/* 5. Technical */}
      <Card>
        <SectionHeader title="5. Technical & Power" isOpen={openSection === 5} toggle={() => toggleSection(5)} />
        {openSection === 5 && (
          <div className="animate-in fade-in slide-in-from-top-2 pt-2">
             <RadioGroup label="LTD3 Line" options={['LTD3', 'Connectable', 'No']} value={data.lineType} onChange={v => setData({...data, lineType: v as any})}/>
             <YesNoSelect label="3-Phase Power Available?" value={data.threePhase} onChange={v => setData({...data, threePhase: v})}/>
             <InputField 
                label="Available Load Capacity (kW)" 
                value={data.capacityLoad} 
                onChange={(v: string) => setData({...data, capacityLoad: v})} 
                type="number" 
                placeholder="e.g. 15"
             />
             <YesNoSelect label="Grounding Feasible?" value={data.grounding} onChange={v => setData({...data, grounding: v})}/>
             <YesNoSelect label="Connection Point ID'd?" value={data.pointIdentified} onChange={v => setData({...data, pointIdentified: v})}/>
             <YesNoSelect label="Meter Photo Taken?" value={data.meterPic} onChange={v => setData({...data, meterPic: v})}/>
             <button onClick={() => setOpenSection(6)} className="w-full mt-4 py-2 bg-slate-100 text-slate-600 font-bold rounded-lg text-sm">Next Section</button>
          </div>
        )}
      </Card>

      {/* 6. Reliability */}
      <Card>
        <SectionHeader title="6. Power Reliability" isOpen={openSection === 6} toggle={() => toggleSection(6)} />
        {openSection === 6 && (
          <div className="animate-in fade-in slide-in-from-top-2 pt-2">
            <YesNoSelect label="No frequent outages?" value={data.noFrequentOutages} onChange={v => setData({...data, noFrequentOutages: v})}/>
            <div className="flex gap-2">
               <InputField label="Freq (30d)" value={data.outageFreq} onChange={(v: string) => setData({...data, outageFreq: v})}/>
               <InputField label="Duration" value={data.outageDur} onChange={(v: string) => setData({...data, outageDur: v})}/>
            </div>
            <YesNoSelect label="Peak-hour load shedding?" value={data.loadShedding} onChange={v => setData({...data, loadShedding: v})}/>
            <button onClick={() => setOpenSection(7)} className="w-full mt-4 py-2 bg-slate-100 text-slate-600 font-bold rounded-lg text-sm">Next Section</button>
          </div>
        )}
      </Card>

      {/* 7. Install & Security */}
      <Card>
        <SectionHeader title="7. Installation & Security" isOpen={openSection === 7} toggle={() => toggleSection(7)} />
        {openSection === 7 && (
          <div className="animate-in fade-in slide-in-from-top-2 pt-2">
            <YesNoSelect label="Sufficient space & ventilation?" value={data.spaceVentilation} onChange={v => setData({...data, spaceVentilation: v})}/>
            <RadioGroup label="Rain Protection" options={['Canopy', 'Indoor', 'Platform']} value={data.rainProtection} onChange={v => setData({...data, rainProtection: v as any})}/>
            <RadioGroup label="Network" options={['4G', 'Broadband']} value={data.network} onChange={v => setData({...data, network: v as any})}/>
            <div className="mb-4">
               <div className="text-xs font-bold text-slate-500 uppercase mb-2">Security Features</div>
               <div className="flex gap-2">
                 {['Lock', 'CCTV', 'Lighting'].map(s => (
                   <label key={s} className={`px-4 py-2 rounded-lg border cursor-pointer ${data.security.includes(s) ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600'}`}>
                     <input type="checkbox" className="hidden" 
                       checked={data.security.includes(s)}
                       onChange={e => {
                         if(e.target.checked) setData({...data, security: [...data.security, s]});
                         else setData({...data, security: data.security.filter(x => x !== s)});
                       }}
                     />
                     <span className="text-xs font-bold">{s}</span>
                   </label>
                 ))}
               </div>
             </div>
             <button onClick={() => setOpenSection(8)} className="w-full mt-4 py-2 bg-slate-100 text-slate-600 font-bold rounded-lg text-sm">Next Section</button>
          </div>
        )}
      </Card>

      {/* 8. Commercial */}
      <Card>
        <SectionHeader title="8. Commercial Readiness" isOpen={openSection === 8} toggle={() => toggleSection(8)} />
        {openSection === 8 && (
          <div className="animate-in fade-in slide-in-from-top-2 pt-2">
            <YesNoSelect label="Owner Willingness Confirmed?" value={data.ownerWilling} onChange={v => setData({...data, ownerWilling: v})}/>
            <RadioGroup label="Model" options={['Purchase', 'Only Use', 'Trial']} value={data.collabModel} onChange={v => setData({...data, collabModel: v as any})}/>
            <InputField label="# User Readiness" value={data.userReadiness} onChange={(v: string) => setData({...data, userReadiness: v})} type="number"/>
            <YesNoSelect label="Benefit Explained/Understood?" value={data.benefitUnderstood} onChange={v => setData({...data, benefitUnderstood: v})}/>
            <InputField label="Issues/Concerns" value={data.concerns} onChange={(v: string) => setData({...data, concerns: v})}/>
          </div>
        )}
      </Card>

      <button 
        onClick={() => onSubmit(data)}
        className="w-full py-4 bg-blue-600 text-white font-bold rounded-xl shadow-xl shadow-blue-600/30 text-lg"
      >
        Complete Assessment
      </button>

    </div>
  );
}

function Step({ active, label, icon: Icon }: { active: boolean, label: string, icon: any }) {
  return (
    <div className={`flex flex-col items-center gap-1 ${active ? 'opacity-100' : 'opacity-40 grayscale'}`}>
      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${active ? 'bg-blue-600 text-white shadow-md' : 'bg-slate-200 text-slate-500'}`}>
        <Icon size={14} />
      </div>
      <span className="text-[10px] font-bold text-slate-600">{label}</span>
    </div>
  );
}
