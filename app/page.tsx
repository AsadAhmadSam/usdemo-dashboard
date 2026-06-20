"use client";

import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { initializeApp, getApps, getApp } from "firebase/app";
import {
  getFirestore, collection, doc, onSnapshot, orderBy, query,
  updateDoc, setDoc, serverTimestamp, Timestamp, DocumentData,
  getDocs, writeBatch,
} from "firebase/firestore";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, User,
} from "firebase/auth";

// US Demo Firebase project config
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBAqwIZDZIw26agXWvaSooVIs64-xFYL78",
  authDomain: "us-demo-45dd8.firebaseapp.com",
  projectId: "us-demo-45dd8",
  storageBucket: "us-demo-45dd8.firebasestorage.app",
  messagingSenderId: "910798525053",
  appId: "1:910798525053:web:8ebfe4ff8972d002d45714",
};

const ADMIN_EMAILS    = ["admin@demo.com"];
const EMPLOYEE_EMAILS = ["employee@stackandslice.com"];

const app  = getApps().length ? getApp() : initializeApp(FIREBASE_CONFIG);
const db   = getFirestore(app);
const auth = getAuth(app);

// ─── Types ────────────────────────────────────────────────────────────────────

type OrderStatus =
  | "PENDING" | "CONFIRMED" | "PREPARING"
  | "READY_FOR_PICKUP" | "OUT_FOR_DELIVERY"
  | "COMPLETED" | "CANCELLED";

type OrderItem = {
  name?: string; quantity?: number; qty?: number;
  notes?: string; itemId?: string;
  categoryId?: string; categoryName?: string;
  unitPrice?: number; price?: number;
};

type DeliveryAddress = {
  name?: string; house?: string; area?: string;
  landmark?: string; phone?: string; notes?: string;
};

type OnlineOrder = {
  id?: string; orderId: string;
  status?: string; source?: string; orderType?: string;
  total?: number; grandTotal?: number;
  createdAt?: Timestamp | Date | string | null;
  updatedAt?: Timestamp | Date | string | null;
  notes?: string;
  customerName?: string; customerPhone?: string;
  customer?: { name?: string; phone?: string; address?: { street?: string } };
  deliveryInfo?: DeliveryAddress;
  items?: OrderItem[];
  feedback?: { rating?: number; comment?: string; submittedAt?: Timestamp | Date | string | null };
  cancelReason?: string; cancelledAt?: Timestamp | Date | string | null; cancelledBy?: string;
  complaintResolved?: boolean; complaintResolvedAt?: Timestamp | Date | string | null; complaintNote?: string;
};

type MenuItem = {
  id: string; name: string; category: string;
  price: number; image?: string; available: boolean; badge?: string;
};

type CustomerSegment = "New" | "Regular" | "VIP";
type AppRole         = "ADMIN" | "EMPLOYEE" | null;
type DateRangePreset = "DAILY" | "WEEKLY" | "MONTHLY" | "CUSTOM";
type TabId           = "dashboard" | "live" | "pickup" | "cancelled" | "history" | "customers" | "feedback" | "complaints" | "promotions" | "reports" | "menu" | "settings";

type CustomerSummary = {
  name: string; phone: string; orders: number; revenue: number;
  firstOrderAt?: Timestamp | Date | string | null;
  lastOrderAt?:  Timestamp | Date | string | null;
  averageOrderValue: number; cancelledOrders: number;
  favouriteItems: string[]; favouriteCategory: string;
  segment: CustomerSegment; allOrders: OnlineOrder[];
};

// ─── Design tokens ────────────────────────────────────────────────────────────

const C = {
  bg:     "#080D19",
  surf:   "#0F1629",
  card:   "#141E35",
  border: "#1E2D47",
  text:   "#F1F5F9",
  muted:  "#64748B",
  accent: "#F97316",
  indigo: "#6366F1",
  green:  "#10B981",
  red:    "#EF4444",
  amber:  "#F59E0B",
  cyan:   "#06B6D4",
  pink:   "#EC4899",
  purple: "#7C3AED",
};

const STATUS_META: Record<string, { bg: string; fg: string; dot: string; label: string }> = {
  PENDING:          { bg: "#2D1A00", fg: "#FCD34D", dot: "#F59E0B", label: "Pending"       },
  CONFIRMED:        { bg: "#13174A", fg: "#A5B4FC", dot: "#6366F1", label: "Confirmed"      },
  PREPARING:        { bg: "#1A0B38", fg: "#C4B5FD", dot: "#7C3AED", label: "Preparing"      },
  READY_FOR_PICKUP: { bg: "#042030", fg: "#67E8F9", dot: "#06B6D4", label: "Ready"          },
  OUT_FOR_DELIVERY: { bg: "#071A30", fg: "#7DD3FC", dot: "#0EA5E9", label: "On the Way"     },
  COMPLETED:        { bg: "#021A12", fg: "#6EE7B7", dot: "#10B981", label: "Completed"      },
  CANCELLED:        { bg: "#200808", fg: "#FCA5A5", dot: "#EF4444", label: "Cancelled"      },
};

const NAV_ITEMS: { id: TabId; label: string; icon: string; accent: string }[] = [
  { id: "dashboard", label: "Dashboard",    icon: "◈",   accent: C.indigo },
  { id: "live",      label: "Live Orders",  icon: "⚡",  accent: C.amber  },
  { id: "pickup",    label: "Pickup Queue", icon: "🏠",  accent: C.cyan   },
  { id: "cancelled", label: "Cancelled",    icon: "✕",   accent: C.red    },
  { id: "history",   label: "History",      icon: "🕐",  accent: C.muted  },
  { id: "customers", label: "Customers",    icon: "👥",  accent: C.pink   },
  { id: "feedback",  label: "Feedback",     icon: "⭐",  accent: "#F59E0B"},
  { id: "complaints",label: "Complaints",   icon: "⚠️",  accent: C.red    },
  { id: "promotions",label: "Promotions",   icon: "🎁",  accent: "#8B5CF6"},
  { id: "reports",   label: "Reports",      icon: "📊",  accent: C.green  },
  { id: "menu",      label: "Menu",         icon: "🍽️", accent: C.accent },
  { id: "settings",  label: "Settings",     icon: "⚙️", accent: "#94A3B8"},
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toDate(v: Timestamp | Date | string | null | undefined): Date | null {
  if (!v) return null;
  if (v instanceof Timestamp) return v.toDate();
  if (v instanceof Date) return v;
  const d = new Date(v as string);
  return isNaN(d.getTime()) ? null : d;
}
function fmt(v: number | undefined) {
  return `$${Number(v || 0).toFixed(2)}`;
}
function fmtDate(v: Timestamp | Date | string | null | undefined) {
  const d = toDate(v);
  return d ? d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "—";
}
function fmtTime(v: Timestamp | Date | string | null | undefined) {
  const d = toDate(v);
  return d ? d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) : "—";
}
function normStatus(s: string | undefined): OrderStatus {
  return String(s || "PENDING").toUpperCase() as OrderStatus;
}
function getTotal(o: OnlineOrder) { return Number(o.total || o.grandTotal || 0); }
function getSale(o: OnlineOrder)  { return normStatus(o.status) === "CANCELLED" ? 0 : getTotal(o); }
function isLive(s: string | undefined) {
  return ["PENDING","CONFIRMED","PREPARING","READY_FOR_PICKUP","OUT_FOR_DELIVERY"].includes(normStatus(s));
}
function isSale(s: string | undefined) {
  return ["CONFIRMED","PREPARING","READY_FOR_PICKUP","OUT_FOR_DELIVERY","COMPLETED"].includes(normStatus(s));
}
function isPickupOrder(o: OnlineOrder) { return (o.orderType || "").toUpperCase() === "PICKUP"; }
function getRoleFromEmail(email: string | null | undefined): AppRole {
  if (!email) return null;
  const n = email.toLowerCase();
  if (ADMIN_EMAILS.map(v => v.toLowerCase()).includes(n)) return "ADMIN";
  if (EMPLOYEE_EMAILS.map(v => v.toLowerCase()).includes(n)) return "EMPLOYEE";
  return null;
}
function getSegment(c: number): CustomerSegment { return c >= 5 ? "VIP" : c >= 2 ? "Regular" : "New"; }
function startOfToday() { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); }
function startOfWeek() {
  const n = new Date(); const d = n.getDay() === 0 ? -6 : 1 - n.getDay();
  const s = new Date(n); s.setDate(n.getDate() + d); s.setHours(0,0,0,0); return s;
}
function startOfMonth() { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), 1); }
function dateInRange(v: Timestamp | Date | string | null | undefined, preset: DateRangePreset, from: string, to: string) {
  const d = toDate(v); if (!d) return false;
  if (preset === "DAILY")   return d >= startOfToday();
  if (preset === "WEEKLY")  return d >= startOfWeek();
  if (preset === "MONTHLY") return d >= startOfMonth();
  const f = from ? new Date(`${from}T00:00:00`) : null;
  const t = to   ? new Date(`${to}T23:59:59`)   : null;
  if (f && d < f) return false; if (t && d > t) return false; return true;
}
function groupCustomers(orders: OnlineOrder[]): CustomerSummary[] {
  const map = new Map<string, {
    name: string; phone: string; orders: number; revenue: number;
    firstOrderAt?: Timestamp | Date | string | null;
    lastOrderAt?:  Timestamp | Date | string | null;
    cancelledOrders: number; itemCounts: Map<string,number>; categoryCounts: Map<string,number>;
    allOrders: OnlineOrder[];
  }>();
  for (const o of orders) {
    const phone = o.deliveryInfo?.phone || o.customer?.phone || o.customerPhone || "Unknown";
    const existing = map.get(phone) || {
      name: o.deliveryInfo?.name || o.customer?.name || o.customerName || "Unknown",
      phone, orders: 0, revenue: 0,
      firstOrderAt: o.createdAt || null, lastOrderAt: o.createdAt || null,
      cancelledOrders: 0, itemCounts: new Map(), categoryCounts: new Map(),
      allOrders: [] as OnlineOrder[],
    };
    existing.orders += 1; existing.revenue += getSale(o);
    if (normStatus(o.status) === "CANCELLED") existing.cancelledOrders += 1;
    existing.allOrders.push(o);
    const cd = toDate(o.createdAt), fd = toDate(existing.firstOrderAt), ld = toDate(existing.lastOrderAt);
    if (cd && (!fd || cd < fd)) existing.firstOrderAt = o.createdAt;
    if (cd && (!ld || cd > ld)) existing.lastOrderAt  = o.createdAt;
    if (existing.name === "Unknown" && (o.deliveryInfo?.name || o.customer?.name || o.customerName))
      existing.name = o.deliveryInfo?.name || o.customer?.name || o.customerName || "Unknown";
    for (const item of o.items || []) {
      const n = item.name || "Unknown"; const qty = Number(item.quantity || item.qty || 1);
      existing.itemCounts.set(n, (existing.itemCounts.get(n) || 0) + qty);
      const cat = item.categoryName || item.categoryId || "Uncategorized";
      existing.categoryCounts.set(cat, (existing.categoryCounts.get(cat) || 0) + qty);
    }
    map.set(phone, existing);
  }
  return [...map.values()].map(c => ({
    name: c.name, phone: c.phone, orders: c.orders, revenue: c.revenue,
    firstOrderAt: c.firstOrderAt, lastOrderAt: c.lastOrderAt,
    averageOrderValue: c.orders ? c.revenue / c.orders : 0,
    cancelledOrders: c.cancelledOrders,
    favouriteItems: [...c.itemCounts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,3).map(([n])=>n),
    favouriteCategory: [...c.categoryCounts.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0] || "—",
    segment: getSegment(c.orders), allOrders: c.allOrders,
  })).sort((a,b) => b.orders - a.orders);
}
function aggregateItems(orders: OnlineOrder[]) {
  const map = new Map<string,{qty:number;sales:number}>();
  for (const o of orders) {
    if (!isSale(o.status)) continue;
    for (const item of o.items || []) {
      const n = item.name || "Unknown"; const qty = Number(item.quantity||item.qty||1);
      const price = Number(item.unitPrice||item.price||0);
      const e = map.get(n) || {qty:0,sales:0}; e.qty += qty; e.sales += qty*price; map.set(n, e);
    }
  }
  return [...map.entries()].map(([name,d])=>({name,...d})).sort((a,b)=>b.sales-a.sales);
}
async function updateOrderStatus(orderId: string, status: OrderStatus) {
  const ref = doc(db, "orders", orderId); const now = serverTimestamp();
  const p: Record<string,unknown> = { status, updatedAt: now };
  if (status==="CONFIRMED")        p.confirmedAt = now;
  if (status==="OUT_FOR_DELIVERY") p.outForDeliveryAt = now;
  if (status==="COMPLETED")        p.completedAt = now;
  if (status==="CANCELLED")        p.cancelledAt = now;
  await updateDoc(ref, p);
}
// ─── Notification sound (generated tone, no external file needed) ─────────────
// Browsers block autoplaying audio with sound until the user has interacted
// with the page at least once — this is a platform restriction, not something
// that can be coded around. playAlertTone() will silently no-op if blocked;
// the visual blinking banner works regardless and is the reliable fallback.
let _alertAudioCtx: AudioContext | null = null;
function playAlertTone() {
  try {
    if (!_alertAudioCtx) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      _alertAudioCtx = new Ctx();
    }
    const ctx = _alertAudioCtx;
    if (ctx.state === "suspended") ctx.resume();
    const now = ctx.currentTime;
    // Two-note "ding-dong" style chime, repeated by the caller on an interval.
    [{ freq: 880, start: 0, dur: 0.16 }, { freq: 660, start: 0.18, dur: 0.22 }].forEach(note => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = note.freq;
      gain.gain.setValueAtTime(0, now + note.start);
      gain.gain.linearRampToValueAtTime(0.35, now + note.start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + note.start + note.dur);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(now + note.start);
      osc.stop(now + note.start + note.dur + 0.02);
    });
  } catch {
    // Audio blocked or unsupported — visual alert still covers it.
  }
}

function exportCSV(customers: CustomerSummary[]) {
  const rows = [
    ["Name","Phone","Segment","Orders","Revenue (USD)","Avg Order","Cancelled","Fav Item","First Order","Last Order"],
    ...customers.map(c => [
      c.name, c.phone, c.segment, c.orders, c.revenue, Math.round(c.averageOrderValue),
      c.cancelledOrders, c.favouriteItems[0]||"—", fmtDate(c.firstOrderAt), fmtDate(c.lastOrderAt),
    ])
  ];
  const csv  = rows.map(r => r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type:"text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a"); a.href=url; a.download="foodhub_customers.csv"; a.click();
  URL.revokeObjectURL(url);
}

// ─── Atoms ────────────────────────────────────────────────────────────────────

function Badge({ status }: { status?: string }) {
  const s = normStatus(status);
  const m = STATUS_META[s] || { bg: C.surf, fg: C.muted, dot: C.border, label: s };
  return (
    <span style={{ background: m.bg, color: m.fg, border: `1px solid ${m.dot}44` }}
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold whitespace-nowrap">
      <span style={{ background: m.dot }} className="h-1.5 w-1.5 rounded-full" />
      {m.label}
    </span>
  );
}

function Pill({ children, color = C.indigo }: { children: React.ReactNode; color?: string }) {
  return (
    <span style={{ background: color+"22", color, border: `1px solid ${color}44` }}
      className="inline-block rounded-full px-2.5 py-0.5 text-xs font-bold">
      {children}
    </span>
  );
}

function Card({ children, className="", style, onClick }: {
  children: React.ReactNode; className?: string;
  style?: React.CSSProperties; onClick?: () => void;
}) {
  return (
    <div onClick={onClick} style={{ background: C.card, border: `1px solid ${C.border}`, ...style }}
      className={`rounded-2xl ${onClick ? "cursor-pointer" : ""} ${className}`}>
      {children}
    </div>
  );
}

function KpiCard({ label, value, sub, accent=C.indigo, icon }: {
  label: string; value: string; sub?: string; accent?: string; icon?: string;
}) {
  return (
    <Card className="p-5 relative overflow-hidden">
      <div style={{ background: accent, opacity:0.07 }} className="absolute inset-0 rounded-2xl pointer-events-none" />
      <div style={{ background: accent, opacity:0.12 }} className="absolute -right-4 -top-4 h-20 w-20 rounded-full pointer-events-none" />
      <div className="relative">
        {icon && <div className="mb-3 text-2xl leading-none">{icon}</div>}
        <div style={{ color: C.muted }} className="text-xs font-bold uppercase tracking-widest">{label}</div>
        <div style={{ color: accent }} className="mt-1 text-2xl font-black leading-tight">{value}</div>
        {sub && <div style={{ color: C.muted }} className="mt-1 text-xs">{sub}</div>}
      </div>
    </Card>
  );
}

function Stars({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1,2,3,4,5].map(i => (
        <span key={i} style={{ color: i<=rating ? C.amber : C.border, fontSize:14 }}>★</span>
      ))}
      <span style={{ color: C.muted }} className="ml-1 text-xs font-bold">{rating}/5</span>
    </div>
  );
}

function FInput({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span style={{ color: C.muted }} className="mb-1.5 block text-xs font-bold uppercase tracking-wider">{label}</span>
      <input {...props}
        style={{ background: C.surf, border:`1px solid ${C.border}`, color: C.text, ...props.style as React.CSSProperties }}
        className="w-full rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-orange-500 disabled:opacity-40 transition-all placeholder:text-slate-600" />
    </label>
  );
}

function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle} type="button"
      style={{ background: on ? C.green : C.border, justifyContent: on?"flex-end":"flex-start", padding:"2px" }}
      className="flex h-7 w-14 items-center rounded-full transition-all">
      <span className="h-5 w-5 rounded-full bg-white shadow-md transition-all" />
    </button>
  );
}

function SectionHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-6">
      <h2 style={{ color: C.text }} className="text-2xl font-black">{title}</h2>
      {sub && <p style={{ color: C.muted }} className="mt-1 text-sm">{sub}</p>}
    </div>
  );
}

function Empty({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="py-16 text-center">
      <div className="text-4xl mb-3">{icon}</div>
      <p style={{ color: C.muted }} className="text-sm">{text}</p>
    </div>
  );
}

// ─── Alert Banner (new order / cancelled order — blinks until acknowledged) ───

type PendingAlert = { id: string; kind: "NEW" | "CANCELLED"; order: OnlineOrder };

function AlertBanner({ alerts, onAcknowledge, onOpenOrder }: {
  alerts: PendingAlert[];
  onAcknowledge: (id: string) => void;
  onOpenOrder: (o: OnlineOrder) => void;
}) {
  if (!alerts.length) return null;
  const a = alerts[0];
  const isNew = a.kind === "NEW";
  const name  = a.order.deliveryInfo?.name || a.order.customer?.name || a.order.customerName || "Customer";
  const color = isNew ? C.green : C.red;

  return (
    <div className="fixed inset-x-0 top-0 z-[60] animate-pulse" style={{ animationDuration: "1s" }}>
      <div style={{ background: color, boxShadow: `0 0 24px ${color}` }}
        className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
        <div className="flex items-center gap-3 text-white">
          <span className="text-2xl leading-none">{isNew ? "🔔" : "⚠️"}</span>
          <div>
            <div className="font-black text-sm">
              {isNew ? "New order received" : "Order cancelled"}
              {alerts.length > 1 && <span className="ml-2 opacity-80">(+{alerts.length - 1} more)</span>}
            </div>
            <div className="text-xs opacity-90">
              {name} · {isPickupOrder(a.order) ? "🏠 Pickup" : "🛵 Delivery"} · {fmt(getTotal(a.order))}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => onOpenOrder(a.order)}
            className="rounded-xl bg-white/20 px-4 py-2 text-xs font-black text-white hover:bg-white/30 transition-all">
            View Order
          </button>
          <button onClick={() => onAcknowledge(a.id)}
            className="rounded-xl bg-white px-4 py-2 text-xs font-black hover:opacity-90 transition-all" style={{ color }}>
            ✓ Acknowledge
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Order Detail Modal ───────────────────────────────────────────────────────

const STATUS_ACTIONS: { status: OrderStatus; label: string; color: string }[] = [
  { status:"CONFIRMED",        label:"✓ Confirm",    color: C.green  },
  { status:"PREPARING",        label:"🍳 Preparing", color: C.purple },
  { status:"READY_FOR_PICKUP", label:"📦 Ready",     color: C.cyan   },
  { status:"OUT_FOR_DELIVERY", label:"🛵 On Way",    color:"#0EA5E9" },
  { status:"COMPLETED",        label:"✅ Complete",  color: C.green  },
  { status:"CANCELLED",        label:"✕ Cancel",     color: C.red    },
];

function OrderDetailModal({ order, onClose, busyOrderId, setBusyOrderId }: {
  order: OnlineOrder; onClose: () => void;
  busyOrderId: string | null; setBusyOrderId: (id: string | null) => void;
}) {
  const phone    = order.deliveryInfo?.phone || order.customer?.phone || order.customerPhone;
  const name     = order.deliveryInfo?.name  || order.customer?.name  || order.customerName || "Unknown Customer";
  const address  = order.deliveryInfo
    ? [order.deliveryInfo.house, order.deliveryInfo.area].filter(Boolean).join(", ")
    : order.customer?.address?.street;
  const landmark = order.deliveryInfo?.landmark;
  const delNotes = order.deliveryInfo?.notes || order.notes;
  const feedback = order.feedback;
  const pickup   = isPickupOrder(order);
  const busy     = busyOrderId === order.orderId;

  async function handle(status: OrderStatus) {
    try { setBusyOrderId(order.orderId); await updateOrderStatus(order.orderId, status); }
    finally { setBusyOrderId(null); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto"
      style={{ background:"rgba(0,0,0,0.88)" }} onClick={onClose}>
      <div className="relative w-full max-w-2xl my-4" onClick={e => e.stopPropagation()}>
        <div style={{ background:C.card, border:`1px solid ${C.border}` }} className="rounded-3xl overflow-hidden shadow-2xl">
          <div style={{ height:4, background:`linear-gradient(90deg,${C.accent},${C.indigo})` }} />

          {/* Header */}
          <div style={{ borderBottom:`1px solid ${C.border}` }} className="flex items-start justify-between p-6 gap-3">
            <div>
              <div style={{ color:C.text }} className="text-xl font-black">{name}</div>
              <div className="flex flex-wrap items-center gap-2 mt-1.5">
                <span style={{ color:C.muted }} className="text-xs font-mono">{order.orderId}</span>
                <Badge status={order.status} />
                <Pill color={pickup ? C.cyan : C.indigo}>{pickup ? "🏠 Pickup" : "🛵 Delivery"}</Pill>
              </div>
            </div>
            <button onClick={onClose}
              style={{ background:C.surf, color:C.muted, border:`1px solid ${C.border}` }}
              className="h-9 w-9 rounded-xl flex items-center justify-center text-xl font-bold hover:opacity-80 flex-shrink-0">×</button>
          </div>

          <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">

            {/* Customer */}
            <div style={{ background:C.surf, border:`1px solid ${C.border}` }} className="rounded-2xl p-4 space-y-3">
              <div style={{ color:C.green }} className="text-xs font-black uppercase tracking-widest">Customer Details</div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <div style={{ color:C.muted }} className="text-xs mb-0.5">Name</div>
                  <div style={{ color:C.text }} className="text-sm font-bold">{name}</div>
                </div>
                <div>
                  <div style={{ color:C.muted }} className="text-xs mb-0.5">Phone</div>
                  {phone
                    ? <a href={`tel:${phone}`} style={{ color:C.green }} className="text-sm font-bold underline">{phone}</a>
                    : <span style={{ color:C.amber }} className="text-sm">Not provided</span>}
                </div>
                {!pickup && address && (
                  <div className="sm:col-span-2">
                    <div style={{ color:C.muted }} className="text-xs mb-0.5">Delivery Address</div>
                    <div style={{ color:C.text }} className="text-sm font-bold">
                      📍 {address}{landmark ? ` — near ${landmark}` : ""}
                    </div>
                  </div>
                )}
                {pickup && (
                  <div className="sm:col-span-2">
                    <div style={{ background:C.cyan+"15", border:`1px solid ${C.cyan}33`, borderRadius:12 }} className="p-3">
                      <div style={{ color:C.cyan }} className="text-sm font-bold">🏠 Pickup — Customer will collect in store</div>
                    </div>
                  </div>
                )}
                {delNotes && (
                  <div className="sm:col-span-2">
                    <div style={{ color:C.muted }} className="text-xs mb-0.5">Notes</div>
                    <div style={{ color:C.text }} className="text-sm">📝 {delNotes}</div>
                  </div>
                )}
              </div>
              <div style={{ color:C.muted, borderTop:`1px solid ${C.border}` }} className="text-xs pt-2">
                🕐 {fmtDate(order.createdAt)}
                {order.updatedAt && <span className="ml-3">Updated: {fmtDate(order.updatedAt)}</span>}
              </div>
            </div>

            {/* Items */}
            <div style={{ background:C.surf, border:`1px solid ${C.border}` }} className="rounded-2xl p-4">
              <div style={{ color:C.muted }} className="text-xs font-black uppercase tracking-widest mb-3">Order Items</div>
              <div className="space-y-2">
                {(order.items || []).map((item, i) => (
                  <div key={i} style={{ borderBottom:`1px solid ${C.border}` }}
                    className="flex items-center justify-between pb-2 last:border-0 last:pb-0">
                    <div>
                      <span style={{ color:C.text }} className="text-sm font-semibold">
                        <span style={{ color:C.accent }} className="font-black">{item.quantity||item.qty||1}×</span> {item.name}
                      </span>
                      {item.notes && <div style={{ color:C.muted }} className="text-xs mt-0.5">{item.notes}</div>}
                    </div>
                    {(item.price||item.unitPrice) && (
                      <span style={{ color:C.text }} className="text-sm font-bold">
                        ${((item.quantity||item.qty||1)*(item.price||item.unitPrice||0)).toFixed(2)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
              <div style={{ borderTop:`1px solid ${C.border}` }} className="mt-3 pt-3 flex justify-between">
                <span style={{ color:C.muted }} className="text-sm font-bold">Total</span>
                <span style={{ color:C.accent }} className="text-xl font-black">{fmt(getTotal(order))}</span>
              </div>
            </div>

            {/* Feedback */}
            {feedback ? (
              <div style={{ background:"#130E00", border:`1px solid ${C.amber}44` }} className="rounded-2xl p-4">
                <div style={{ color:C.amber }} className="text-xs font-black uppercase tracking-widest mb-3">Customer Feedback</div>
                <Stars rating={feedback.rating||0} />
                {feedback.comment
                  ? <div style={{ background:C.surf, border:`1px solid ${C.border}` }} className="mt-3 rounded-xl p-3">
                      <p style={{ color:C.text }} className="text-sm italic">"{feedback.comment}"</p>
                    </div>
                  : <p style={{ color:C.muted }} className="mt-2 text-xs">No written comment.</p>}
                {feedback.submittedAt && <div style={{ color:C.muted }} className="mt-2 text-xs">{fmtDate(feedback.submittedAt)}</div>}
              </div>
            ) : (
              <div style={{ border:`1px dashed ${C.border}`, color:C.muted }} className="rounded-2xl p-4 text-sm text-center">
                No feedback received for this order yet.
              </div>
            )}

            {/* Actions */}
            <div>
              <div style={{ color:C.muted }} className="text-xs font-black uppercase tracking-widest mb-3">Update Status</div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {STATUS_ACTIONS.map(a => (
                  <button key={a.status} disabled={busy} onClick={() => handle(a.status)}
                    style={{ background:a.color+"22", color:a.color, border:`1px solid ${a.color}44` }}
                    className="rounded-xl py-3 text-xs font-bold disabled:opacity-40 hover:opacity-80 transition-all">
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Login ────────────────────────────────────────────────────────────────────

function LoginScreen({ onLogin }: { onLogin: (e: string, p: string) => Promise<void> }) {
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try { setLoading(true); setError(""); await onLogin(email, password); }
    catch (err) { setError(err instanceof Error ? err.message : "Login failed."); }
    finally { setLoading(false); }
  }

  return (
    <div style={{ background:`radial-gradient(ellipse at top,#0F1A35,${C.bg})` }}
      className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="mb-10 text-center">
          <div style={{ background:"linear-gradient(135deg,#F97316,#EF4444)" }}
            className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-3xl text-4xl shadow-2xl">🍔</div>
          <h1 style={{ color:C.text }} className="text-4xl font-black tracking-tight">Stack & Slice</h1>
          <p style={{ color:C.muted }} className="mt-2">Restaurant Management Dashboard</p>
        </div>
        <form onSubmit={submit}>
          <div style={{ background:C.card, border:`1px solid ${C.border}` }} className="rounded-3xl p-8 space-y-5">
            <FInput label="Email" type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="admin@foodhub.com" />
            <FInput label="Password" type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••" />
            {error && (
              <div style={{ background:"#200808", border:`1px solid ${C.red}44`, color:"#FCA5A5" }}
                className="rounded-xl px-4 py-3 text-sm font-medium">{error}</div>
            )}
            <button disabled={loading} type="submit"
              style={{ background:"linear-gradient(135deg,#F97316,#EF4444)" }}
              className="w-full rounded-xl px-5 py-4 text-sm font-black text-white disabled:opacity-50 hover:opacity-90 transition-all">
              {loading ? "Signing in…" : "Sign In →"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function Sidebar({ tab, setTab, open, setOpen, role, liveCount, pickupCount }: {
  tab: TabId; setTab: (t: TabId) => void; open: boolean; setOpen: (v: boolean) => void;
  role: AppRole; liveCount: number; pickupCount: number;
}) {
  const filtered = NAV_ITEMS.filter(i => role==="EMPLOYEE" ? !["settings","menu"].includes(i.id) : true);
  const badge = (id: TabId) => {
    if (id==="live"   && liveCount   > 0) return liveCount;
    if (id==="pickup" && pickupCount > 0) return pickupCount;
    return null;
  };

  const panel = (
    <div style={{ background:"#06090F", borderRight:`1px solid ${C.border}` }} className="flex h-full flex-col py-6 px-4">
      <div className="mb-8 px-2 flex items-center gap-3">
        <div style={{ background:"linear-gradient(135deg,#F97316,#EF4444)" }}
          className="h-10 w-10 flex items-center justify-center rounded-xl text-xl flex-shrink-0">🍔</div>
        <div>
          <div style={{ color:C.text }} className="font-black text-sm">Stack & Slice</div>
          <div style={{ color:C.muted }} className="text-xs">Owner Dashboard</div>
        </div>
      </div>
      <nav className="flex-1 space-y-0.5">
        {filtered.map(item => {
          const active = tab === item.id;
          const b = badge(item.id);
          return (
            <button key={item.id} onClick={() => { setTab(item.id); setOpen(false); }}
              style={active ? { background:item.accent+"20", color:item.accent } : { color:C.muted }}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm transition-all hover:opacity-80">
              <span className="text-lg leading-none w-6 text-center">{item.icon}</span>
              <span className={`flex-1 text-left ${active ? "font-bold" : "font-medium"}`}>{item.label}</span>
              {b !== null
                ? <span style={{ background:C.red, color:"#fff" }} className="rounded-full px-2 py-0.5 text-xs font-black">{b}</span>
                : active && <span style={{ background:item.accent }} className="h-1.5 w-1.5 rounded-full" />}
            </button>
          );
        })}
      </nav>
      <div style={{ background:C.surf, border:`1px solid ${C.border}` }} className="mt-4 rounded-xl p-3">
        <div style={{ color:C.muted }} className="text-xs font-bold">Role: {role||"—"}</div>
        <div style={{ color:C.border }} className="text-xs mt-0.5">Stack & Slice · Gizri, Karachi</div>
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden lg:block lg:w-[230px] flex-shrink-0 h-screen sticky top-0">{panel}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" style={{ background:"rgba(0,0,0,0.75)" }} onClick={() => setOpen(false)}>
          <div className="h-full w-[230px]" onClick={e => e.stopPropagation()}>{panel}</div>
        </div>
      )}
    </>
  );
}

// ─── TopBar ───────────────────────────────────────────────────────────────────

function TopBar({ title, icon, setMenuOpen, user, role, onSignOut, liveCount }: {
  title: string; icon: string; setMenuOpen: (v: boolean) => void;
  user: User|null; role: AppRole; onSignOut: () => void; liveCount: number;
}) {
  return (
    <div style={{ background:C.card, border:`1px solid ${C.border}` }}
      className="sticky top-0 z-20 flex items-center justify-between rounded-2xl px-5 py-4 mb-6">
      <div className="flex items-center gap-3">
        <button onClick={() => setMenuOpen(true)}
          style={{ background:C.surf, border:`1px solid ${C.border}`, color:C.muted }}
          className="rounded-xl px-3 py-2 text-xl lg:hidden">☰</button>
        <div>
          <div style={{ color:C.text }} className="flex items-center gap-2 text-lg font-black">{icon} {title}</div>
          <div style={{ color:C.muted }} className="text-xs">{user?.email}</div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {liveCount > 0 && (
          <span style={{ background:C.red+"22", color:C.red, border:`1px solid ${C.red}44` }}
            className="hidden rounded-full px-3 py-1 text-xs font-black sm:inline animate-pulse">
            ● {liveCount} active
          </span>
        )}
        <span style={{ background:C.green+"22", color:C.green, border:`1px solid ${C.green}44` }}
          className="hidden rounded-full px-3 py-1 text-xs font-bold sm:inline">● LIVE</span>
        <button onClick={onSignOut}
          style={{ background:C.surf, border:`1px solid ${C.border}`, color:C.muted }}
          className="rounded-xl px-4 py-2 text-xs font-semibold hover:opacity-80">Sign Out</button>
      </div>
    </div>
  );
}

// ─── Order Row ────────────────────────────────────────────────────────────────

function OrderRow({ order, onClick }: { order: OnlineOrder; onClick: () => void }) {
  const name  = order.deliveryInfo?.name || order.customer?.name || order.customerName || "Unknown";
  const phone = order.deliveryInfo?.phone || order.customer?.phone || order.customerPhone || "—";
  const pickup = isPickupOrder(order);
  return (
    <button onClick={onClick}
      style={{ background:C.surf, border:`1px solid ${C.border}` }}
      className="w-full text-left flex flex-wrap items-center justify-between gap-2 rounded-xl px-4 py-3 hover:border-orange-500 transition-all">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span style={{ color:C.text }} className="text-sm font-bold truncate">{name}</span>
          <Pill color={pickup ? C.cyan : C.indigo}>{pickup ? "Pickup" : "Delivery"}</Pill>
        </div>
        <div style={{ color:C.muted }} className="text-xs mt-0.5 truncate">📞 {phone} · {order.orderId?.substring(0,10)}…</div>
        <div style={{ color:C.muted }} className="text-xs">🕐 {fmtDate(order.createdAt)}</div>
      </div>
      <div className="text-right flex-shrink-0">
        <div style={{ color:C.accent }} className="text-sm font-black">{fmt(getTotal(order))}</div>
        <div className="mt-1"><Badge status={order.status} /></div>
        {order.feedback?.rating && (
          <div style={{ color:C.amber }} className="mt-1 text-xs">
            {"★".repeat(order.feedback.rating)}{"☆".repeat(5-order.feedback.rating)}
            {order.feedback.comment && <span style={{ color:C.muted }} className="ml-1">💬</span>}
          </div>
        )}
      </div>
    </button>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

function DashboardView({ orders, customers, goToLive, onOrderClick }: {
  orders: OnlineOrder[]; customers: CustomerSummary[];
  goToLive: () => void; onOrderClick: (o: OnlineOrder) => void;
}) {
  const today     = orders.filter(o => dateInRange(o.createdAt,"DAILY","",""));
  const revenue   = today.reduce((s,o) => s+getSale(o), 0);
  const active    = today.filter(o => isLive(o.status)).length;
  const pending   = today.filter(o => normStatus(o.status)==="PENDING").length;
  const avgVal    = today.length ? revenue/today.length : 0;
  const pickups   = today.filter(o => isPickupOrder(o));
  const deliveries= today.filter(o => !isPickupOrder(o));
  const feedbacks = orders.filter(o => o.feedback?.rating);
  const avgRating = feedbacks.length ? feedbacks.reduce((s,o)=>s+(o.feedback?.rating||0),0)/feedbacks.length : 0;

  return (
    <section className="space-y-6">
      <div>
        <h1 style={{ color:C.text }} className="text-3xl font-black">Good day 👋</h1>
        <p style={{ color:C.muted }} className="mt-1 text-sm">Here's how Stack & Slice is performing right now.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Revenue Today"  value={fmt(revenue)}         sub="Confirmed + completed" accent={C.green}  icon="💰" />
        <KpiCard label="Active Orders"  value={String(active)}       sub={`${pending} pending`}  accent={C.amber}  icon="⚡" />
        <KpiCard label="Orders Today"   value={String(today.length)} sub="All types"             accent={C.indigo} icon="📋" />
        <KpiCard label="Avg Order"      value={fmt(avgVal)}          sub="Per transaction"       accent={C.pink}   icon="📊" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Pickup Today"   value={String(pickups.length)}    accent={C.cyan}   icon="🏠" />
        <KpiCard label="Delivery Today" value={String(deliveries.length)} accent={C.indigo} icon="🛵" />
        <KpiCard label="Cancelled"      value={String(today.filter(o=>normStatus(o.status)==="CANCELLED").length)} accent={C.red} icon="✕" />
        <KpiCard label="Avg Rating"     value={avgRating ? avgRating.toFixed(1)+"★" : "—"} sub={`${feedbacks.length} reviews`} accent={C.amber} icon="⭐" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 style={{ color:C.text }} className="text-base font-black">Recent Orders</h2>
              <p style={{ color:C.muted }} className="text-xs">Tap any row to open & manage</p>
            </div>
            <button onClick={goToLive}
              style={{ background:C.indigo+"22", color:C.indigo, border:`1px solid ${C.indigo}44` }}
              className="rounded-xl px-4 py-2 text-xs font-bold hover:opacity-80">View All →</button>
          </div>
          <div className="space-y-2">
            {orders.slice(0,8).map(o => <OrderRow key={o.orderId} order={o} onClick={() => onOrderClick(o)} />)}
            {!orders.length && <Empty icon="📭" text="No orders yet." />}
          </div>
        </Card>

        <Card className="p-5">
          <h2 style={{ color:C.text }} className="mb-4 text-base font-black">Top Customers</h2>
          <div className="space-y-2">
            {customers.slice(0,6).map(c => (
              <div key={c.phone} style={{ background:C.surf, border:`1px solid ${C.border}` }}
                className="flex items-center justify-between rounded-xl px-4 py-3">
                <div>
                  <div style={{ color:C.text }} className="text-sm font-semibold">{c.name}</div>
                  <div style={{ color:C.muted }} className="text-xs">{c.phone}</div>
                </div>
                <div className="text-right">
                  <div style={{ color:C.accent }} className="text-xs font-black">{c.orders} orders</div>
                  <Pill color={c.segment==="VIP"?C.amber:c.segment==="Regular"?C.indigo:C.muted}>{c.segment}</Pill>
                </div>
              </div>
            ))}
            {!customers.length && <Empty icon="👥" text="No customers yet." />}
          </div>
        </Card>
      </div>

      {feedbacks.length > 0 && (
        <Card className="p-5">
          <h2 style={{ color:C.text }} className="mb-4 text-base font-black">Recent Customer Feedback</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {feedbacks.slice(0,6).map(o => (
              <button key={o.orderId} onClick={() => onOrderClick(o)}
                style={{ background:C.surf, border:`1px solid ${C.border}` }}
                className="rounded-xl p-4 text-left hover:border-amber-500 transition-all">
                <div style={{ color:C.text }} className="text-sm font-bold mb-1">
                  {o.deliveryInfo?.name||o.customer?.name||o.customerName||"Customer"}
                </div>
                <Stars rating={o.feedback?.rating||0} />
                {o.feedback?.comment && (
                  <p style={{ color:C.muted }} className="mt-2 text-xs italic line-clamp-2">"{o.feedback.comment}"</p>
                )}
              </button>
            ))}
          </div>
        </Card>
      )}
    </section>
  );
}

// ─── Live Orders ──────────────────────────────────────────────────────────────

function LiveOrdersView({ orders, busyOrderId, setBusyOrderId, onOrderClick }: {
  orders: OnlineOrder[]; busyOrderId: string|null;
  setBusyOrderId: (id: string|null) => void; onOrderClick: (o: OnlineOrder) => void;
}) {
  const [search, setSearch] = useState("");
  const [sFilter, setSFilter] = useState("ALL");
  const live = orders.filter(o => isLive(o.status));
  const statuses = ["ALL","PENDING","CONFIRMED","PREPARING","READY_FOR_PICKUP","OUT_FOR_DELIVERY"];

  const filtered = useMemo(() => live.filter(o => {
    const text = [o.orderId,o.deliveryInfo?.name,o.customer?.name,o.customerName,o.deliveryInfo?.phone,o.customer?.phone,o.customerPhone]
      .filter(Boolean).join(" ").toLowerCase();
    return text.includes(search.toLowerCase()) && (sFilter==="ALL"||normStatus(o.status)===sFilter);
  }), [live, search, sFilter]);

  return (
    <section className="space-y-5">
      <SectionHeader title="⚡ Live Orders" sub={`${live.length} active orders · tap any order to manage`} />
      <Card className="p-4">
        <div className="flex flex-col gap-3 xl:flex-row">
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search by name, phone, order ID…"
            style={{ background:C.surf, border:`1px solid ${C.border}`, color:C.text }}
            className="w-full rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-orange-500 placeholder:text-slate-600" />
          <div className="flex flex-wrap gap-2">
            {statuses.map(s => {
              const m = STATUS_META[s]; const active = sFilter===s;
              return (
                <button key={s} onClick={() => setSFilter(s)}
                  style={active ? { background:m?.dot||C.accent, color:"#fff" } : { background:C.surf, color:C.muted, border:`1px solid ${C.border}` }}
                  className="rounded-xl px-3 py-2 text-xs font-bold whitespace-nowrap transition-all">
                  {s==="ALL" ? "All" : s.replace(/_/g," ")}
                </button>
              );
            })}
          </div>
        </div>
      </Card>
      <div className="space-y-3">
        {filtered.length ? filtered.map(o => (
          <Card key={o.orderId} onClick={() => onOrderClick(o)} className="overflow-hidden hover:border-orange-500 transition-all">
            <div style={{ background:STATUS_META[normStatus(o.status)]?.dot, height:3 }} />
            <div className="p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span style={{ color:C.text }} className="font-black">
                    {o.deliveryInfo?.name||o.customer?.name||o.customerName||"Unknown"}
                  </span>
                  <Badge status={o.status} />
                  <Pill color={isPickupOrder(o)?C.cyan:C.indigo}>{isPickupOrder(o)?"🏠 Pickup":"🛵 Delivery"}</Pill>
                </div>
                <div style={{ color:C.muted }} className="text-xs mt-1">
                  📞 {o.deliveryInfo?.phone||o.customerPhone||"—"} · {o.orderId?.substring(0,12)}… · {fmtTime(o.createdAt)}
                </div>
                {(o.deliveryInfo?.house||o.deliveryInfo?.area) && (
                  <div style={{ color:C.muted }} className="text-xs mt-0.5">
                    📍 {[o.deliveryInfo.house,o.deliveryInfo.area].filter(Boolean).join(", ")}
                  </div>
                )}
              </div>
              <div className="text-right">
                <div style={{ color:C.accent }} className="text-xl font-black">{fmt(getTotal(o))}</div>
                <div style={{ color:C.indigo }} className="text-xs mt-1 font-semibold">Tap to manage →</div>
              </div>
            </div>
          </Card>
        )) : <Card className="p-12"><Empty icon="✅" text="No live orders match your filter." /></Card>}
      </div>
    </section>
  );
}

// ─── Pickup Queue (Kanban) ────────────────────────────────────────────────────

function PickupQueueView({ orders, busyOrderId, setBusyOrderId, onOrderClick }: {
  orders: OnlineOrder[]; busyOrderId: string|null;
  setBusyOrderId: (id: string|null) => void; onOrderClick: (o: OnlineOrder) => void;
}) {
  const pickups = orders.filter(o => isPickupOrder(o) && isLive(o.status));

  const STAGES: { key: string; label: string; color: string; next?: OrderStatus; nextLabel?: string }[] = [
    { key:"PENDING",          label:"⏳ New Orders",  color:C.amber,  next:"CONFIRMED",        nextLabel:"Confirm" },
    { key:"CONFIRMED",        label:"✓ Confirmed",    color:C.indigo, next:"PREPARING",        nextLabel:"Start Cooking" },
    { key:"PREPARING",        label:"🍳 In Kitchen",  color:C.purple, next:"READY_FOR_PICKUP", nextLabel:"Mark Ready" },
    { key:"READY_FOR_PICKUP", label:"📦 Ready!",      color:C.green,  next:"COMPLETED",        nextLabel:"✅ Collected" },
  ];

  async function quickUpdate(o: OnlineOrder, status: OrderStatus) {
    try { setBusyOrderId(o.orderId); await updateOrderStatus(o.orderId, status); }
    finally { setBusyOrderId(null); }
  }

  return (
    <section className="space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <SectionHeader title="🏠 Pickup Queue" sub={`${pickups.length} active pickup orders · Kanban board`} />
        <Pill color={C.cyan}>{pickups.length} active</Pill>
      </div>

      {pickups.length === 0 && <Card className="p-16"><Empty icon="🏠" text="No active pickup orders right now." /></Card>}

      <div className="grid gap-4 xl:grid-cols-4">
        {STAGES.map(stage => {
          const stageOrders = pickups.filter(o => normStatus(o.status) === stage.key);
          return (
            <div key={stage.key}>
              <div className="mb-3 flex items-center gap-2">
                <span style={{ color:stage.color }} className="font-black text-sm">{stage.label}</span>
                <span style={{ background:stage.color+"22", color:stage.color }} className="rounded-full px-2 py-0.5 text-xs font-black">{stageOrders.length}</span>
              </div>
              <div className="space-y-2 min-h-[120px]">
                {stageOrders.map(o => {
                  const name = o.deliveryInfo?.name||o.customer?.name||o.customerName||"Customer";
                  const busy = busyOrderId === o.orderId;
                  return (
                    <div key={o.orderId}
                      style={{ background:C.card, border:`1px solid ${stage.color}55` }}
                      className="rounded-2xl p-4 space-y-3">
                      <div>
                        <div style={{ color:C.text }} className="font-bold text-sm">{name}</div>
                        <div style={{ color:C.muted }} className="text-xs">{fmtTime(o.createdAt)}</div>
                        <div style={{ color:C.accent }} className="text-sm font-black mt-1">{fmt(getTotal(o))}</div>
                      </div>
                      {(o.items||[]).slice(0,3).map((item,i) => (
                        <div key={i} style={{ color:C.muted }} className="text-xs">
                          {item.quantity||item.qty||1}× {item.name}
                        </div>
                      ))}
                      {(o.items||[]).length > 3 && <div style={{ color:C.border }} className="text-xs">+{(o.items||[]).length-3} more items</div>}
                      <div className="flex gap-2 pt-1">
                        {stage.next && (
                          <button disabled={busy} onClick={() => quickUpdate(o, stage.next!)}
                            style={{ background:stage.color, color:"#fff" }}
                            className="flex-1 rounded-xl py-2 text-xs font-bold disabled:opacity-40 hover:opacity-80 transition-all">
                            {busy ? "…" : stage.nextLabel}
                          </button>
                        )}
                        <button onClick={() => onOrderClick(o)}
                          style={{ background:C.surf, color:C.muted, border:`1px solid ${C.border}` }}
                          className="rounded-xl px-3 py-2 text-xs font-bold hover:opacity-80">⋯</button>
                      </div>
                    </div>
                  );
                })}
                {stageOrders.length === 0 && (
                  <div style={{ background:C.surf, border:`1px dashed ${C.border}` }} className="rounded-2xl p-6 text-center">
                    <p style={{ color:C.border }} className="text-xs">Empty</p>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ─── History ──────────────────────────────────────────────────────────────────

function HistoryView({ orders, onOrderClick }: { orders: OnlineOrder[]; onOrderClick: (o: OnlineOrder) => void }) {
  const history = orders.filter(o => ["COMPLETED","CANCELLED"].includes(normStatus(o.status)));
  const [search, setSearch] = useState("");
  const [sFilter, setSFilter] = useState("ALL");

  const filtered = history.filter(o => {
    const text = [o.orderId,o.deliveryInfo?.name,o.customer?.name,o.customerName,o.deliveryInfo?.phone,o.customerPhone]
      .filter(Boolean).join(" ").toLowerCase();
    return text.includes(search.toLowerCase()) && (sFilter==="ALL"||normStatus(o.status)===sFilter);
  });

  return (
    <section className="space-y-5">
      <SectionHeader title="🕐 Order History" sub={`${history.length} completed/cancelled orders · tap to view details`} />
      <Card className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search by name, phone, order ID…"
            style={{ background:C.surf, border:`1px solid ${C.border}`, color:C.text }}
            className="w-full rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-orange-500 placeholder:text-slate-600" />
          <div className="flex gap-2">
            {["ALL","COMPLETED","CANCELLED"].map(s => (
              <button key={s} onClick={() => setSFilter(s)}
                style={sFilter===s
                  ? { background:s==="COMPLETED"?C.green:s==="CANCELLED"?C.red:C.accent, color:"#fff" }
                  : { background:C.surf, color:C.muted, border:`1px solid ${C.border}` }}
                className="rounded-xl px-3 py-2 text-xs font-bold whitespace-nowrap">{s}</button>
            ))}
          </div>
        </div>
      </Card>
      <Card className="p-4">
        <div className="space-y-2">
          {filtered.length ? filtered.map(o => <OrderRow key={o.orderId} order={o} onClick={() => onOrderClick(o)} />)
            : <Empty icon="📭" text="No orders found." />}
        </div>
      </Card>
    </section>
  );
}

// ─── Cancelled Orders View ─────────────────────────────────────────────────────

function CancelledOrdersView({ orders, onOrderClick }: { orders: OnlineOrder[]; onOrderClick: (o: OnlineOrder) => void }) {
  const cancelled = orders.filter(o => normStatus(o.status) === "CANCELLED");
  const [search, setSearch] = useState("");

  const filtered = cancelled.filter(o => {
    const text = [o.orderId, o.deliveryInfo?.name, o.customer?.name, o.customerName, o.cancelReason]
      .filter(Boolean).join(" ").toLowerCase();
    return text.includes(search.toLowerCase());
  });

  const reasonCounts: Record<string, number> = {};
  cancelled.forEach(o => {
    const r = o.cancelReason || "No reason provided";
    reasonCounts[r] = (reasonCounts[r] || 0) + 1;
  });
  const topReasons = Object.entries(reasonCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);

  return (
    <section className="space-y-5">
      <SectionHeader title="✕ Cancelled Orders" sub={`${cancelled.length} cancelled orders · reasons tracked below`} />

      {topReasons.length > 0 && (
        <Card className="p-4">
          <div style={{ color: C.muted }} className="text-xs font-bold mb-3 uppercase tracking-wide">Top Cancellation Reasons</div>
          <div className="flex flex-wrap gap-2">
            {topReasons.map(([reason, count]) => (
              <div key={reason} style={{ background: C.surf, border: `1px solid ${C.border}` }}
                className="rounded-xl px-3 py-2 text-xs flex items-center gap-2">
                <span style={{ color: C.text }} className="font-semibold">{reason}</span>
                <span style={{ background: C.red, color: "#fff" }} className="rounded-full px-2 py-0.5 text-[10px] font-bold">{count}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="p-4">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name, phone, order ID, or reason…"
          style={{ background: C.surf, border: `1px solid ${C.border}`, color: C.text }}
          className="w-full rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-orange-500 placeholder:text-slate-600" />
      </Card>

      <Card className="p-4">
        <div className="space-y-2">
          {filtered.length ? filtered.map(o => (
            <div key={o.orderId} onClick={() => onOrderClick(o)} style={{ background: C.surf, border: `1px solid ${C.border}` }}
              className="rounded-xl p-4 cursor-pointer hover:opacity-80 transition-all">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div style={{ color: C.text }} className="text-sm font-bold">
                    {o.deliveryInfo?.name || o.customer?.name || o.customerName || "Customer"}
                  </div>
                  <div style={{ color: C.muted }} className="text-xs mt-1">#{o.orderId?.slice(-6).toUpperCase()} · {fmtDate(o.cancelledAt || o.updatedAt)}</div>
                </div>
                <div style={{ color: C.text }} className="text-sm font-bold">{fmt(getTotal(o))}</div>
              </div>
              <div style={{ background: "#2D1212", border: "1px solid #4A1F1F" }} className="rounded-lg px-3 py-2 mt-3 text-xs">
                <span style={{ color: "#FCA5A5" }} className="font-semibold">Reason: </span>
                <span style={{ color: "#FED7D7" }}>{o.cancelReason || "No reason provided"}</span>
              </div>
            </div>
          )) : <Empty icon="✕" text="No cancelled orders." />}
        </div>
      </Card>
    </section>
  );
}

// ─── Feedback & Ratings View ───────────────────────────────────────────────────

function FeedbackRatingsView({ orders, onOrderClick }: { orders: OnlineOrder[]; onOrderClick: (o: OnlineOrder) => void }) {
  const withFeedback = orders.filter(o => o.feedback && o.feedback.rating);
  const [starFilter, setStarFilter] = useState<number | "ALL">("ALL");

  const avgRating = withFeedback.length
    ? withFeedback.reduce((sum, o) => sum + (o.feedback?.rating || 0), 0) / withFeedback.length
    : 0;

  const distribution = [5, 4, 3, 2, 1].map(star => ({
    star, count: withFeedback.filter(o => o.feedback?.rating === star).length,
  }));

  const filtered = starFilter === "ALL" ? withFeedback : withFeedback.filter(o => o.feedback?.rating === starFilter);
  const sorted = [...filtered].sort((a, b) => {
    const da = toDate(a.feedback?.submittedAt)?.getTime() || 0;
    const db = toDate(b.feedback?.submittedAt)?.getTime() || 0;
    return db - da;
  });

  return (
    <section className="space-y-5">
      <SectionHeader title="⭐ Feedback & Ratings" sub={`${withFeedback.length} reviews submitted`} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="p-6 text-center">
          <div style={{ color: "#F59E0B" }} className="text-4xl font-black">{avgRating.toFixed(1)}</div>
          <div style={{ color: C.muted }} className="text-xs mt-1">Average Rating · {withFeedback.length} reviews</div>
          <div className="mt-2 text-xl">{"⭐".repeat(Math.round(avgRating))}{"☆".repeat(5 - Math.round(avgRating))}</div>
        </Card>
        <Card className="p-4">
          <div className="space-y-1.5">
            {distribution.map(({ star, count }) => (
              <div key={star} className="flex items-center gap-2">
                <span style={{ color: C.muted }} className="text-xs w-10">{star}★</span>
                <div style={{ background: C.surf }} className="flex-1 h-2 rounded-full overflow-hidden">
                  <div style={{ background: "#F59E0B", width: withFeedback.length ? `${(count / withFeedback.length) * 100}%` : "0%" }} className="h-full" />
                </div>
                <span style={{ color: C.muted }} className="text-xs w-6 text-right">{count}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card className="p-4">
        <div className="flex gap-2 flex-wrap">
          {(["ALL", 5, 4, 3, 2, 1] as const).map(s => (
            <button key={s} onClick={() => setStarFilter(s)}
              style={starFilter === s ? { background: "#F59E0B", color: "#0a0a0a" } : { background: C.surf, color: C.muted, border: `1px solid ${C.border}` }}
              className="rounded-xl px-3 py-2 text-xs font-bold">
              {s === "ALL" ? "All" : `${s}★`}
            </button>
          ))}
        </div>
      </Card>

      <Card className="p-4">
        <div className="space-y-3">
          {sorted.length ? sorted.map(o => (
            <div key={o.orderId} onClick={() => onOrderClick(o)} style={{ background: C.surf, border: `1px solid ${C.border}` }}
              className="rounded-xl p-4 cursor-pointer hover:opacity-80 transition-all">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div>
                  <div style={{ color: C.text }} className="text-sm font-bold">
                    {o.deliveryInfo?.name || o.customer?.name || o.customerName || "Customer"}
                  </div>
                  <div style={{ color: C.muted }} className="text-xs mt-0.5">#{o.orderId?.slice(-6).toUpperCase()} · {fmtDate(o.feedback?.submittedAt)}</div>
                </div>
                <div className="text-base">{"⭐".repeat(o.feedback?.rating || 0)}</div>
              </div>
              {o.feedback?.comment && (
                <div style={{ color: C.muted }} className="text-sm italic mt-2">"{o.feedback.comment}"</div>
              )}
            </div>
          )) : <Empty icon="⭐" text="No feedback in this range yet." />}
        </div>
      </Card>
    </section>
  );
}

// ─── Complaints View ────────────────────────────────────────────────────────────
// Derived from low ratings (≤2 stars with a comment) and cancelled orders.
// Owner can mark each as resolved, which is saved back to Firestore on the order.

function ComplaintsView({ orders, onOrderClick }: { orders: OnlineOrder[]; onOrderClick: (o: OnlineOrder) => void }) {
  const complaints = orders.filter(o =>
    (o.feedback && (o.feedback.rating || 0) <= 2) ||
    (normStatus(o.status) === "CANCELLED" && o.cancelReason)
  );
  const [showResolved, setShowResolved] = useState(false);

  const unresolved = complaints.filter(o => !o.complaintResolved);
  const resolved = complaints.filter(o => o.complaintResolved);
  const list = showResolved ? resolved : unresolved;

  async function markResolved(o: OnlineOrder, note: string) {
    if (!o.id && !o.orderId) return;
    try {
      await updateDoc(doc(db, "orders", o.id || o.orderId), {
        complaintResolved: true,
        complaintResolvedAt: serverTimestamp(),
        complaintNote: note || "",
      });
    } catch (e) { console.error("[Complaints] resolve failed:", e); }
  }

  return (
    <section className="space-y-5">
      <SectionHeader title="⚠️ Complaints" sub={`${unresolved.length} unresolved · ${resolved.length} resolved`} />

      <Card className="p-4">
        <div className="flex gap-2">
          <button onClick={() => setShowResolved(false)}
            style={!showResolved ? { background: C.red, color: "#fff" } : { background: C.surf, color: C.muted, border: `1px solid ${C.border}` }}
            className="rounded-xl px-4 py-2 text-xs font-bold">Unresolved ({unresolved.length})</button>
          <button onClick={() => setShowResolved(true)}
            style={showResolved ? { background: C.green, color: "#fff" } : { background: C.surf, color: C.muted, border: `1px solid ${C.border}` }}
            className="rounded-xl px-4 py-2 text-xs font-bold">Resolved ({resolved.length})</button>
        </div>
      </Card>

      <Card className="p-4">
        <div className="space-y-3">
          {list.length ? list.map(o => (
            <ComplaintRow key={o.orderId} order={o} onOrderClick={onOrderClick} onResolve={markResolved} resolved={showResolved} />
          )) : <Empty icon="✅" text={showResolved ? "Nothing resolved yet." : "No open complaints — nice work."} />}
        </div>
      </Card>
    </section>
  );
}

function ComplaintRow({ order, onOrderClick, onResolve, resolved }: {
  order: OnlineOrder; onOrderClick: (o: OnlineOrder) => void;
  onResolve: (o: OnlineOrder, note: string) => void; resolved: boolean;
}) {
  const [note, setNote] = useState("");
  const isCancelComplaint = normStatus(order.status) === "CANCELLED" && order.cancelReason && !(order.feedback && (order.feedback.rating || 0) <= 2);

  return (
    <div style={{ background: C.surf, border: `1px solid ${C.border}` }} className="rounded-xl p-4">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div onClick={() => onOrderClick(order)} className="cursor-pointer hover:opacity-80">
          <div style={{ color: C.text }} className="text-sm font-bold">
            {order.deliveryInfo?.name || order.customer?.name || order.customerName || "Customer"}
          </div>
          <div style={{ color: C.muted }} className="text-xs mt-0.5">#{order.orderId?.slice(-6).toUpperCase()}</div>
        </div>
        {!isCancelComplaint && <div className="text-base">{"⭐".repeat(order.feedback?.rating || 0)}</div>}
      </div>
      <div style={{ background: "#2D1212", border: "1px solid #4A1F1F", color: "#FED7D7" }} className="rounded-lg px-3 py-2 text-xs mb-2">
        {isCancelComplaint ? `Cancelled: ${order.cancelReason}` : (order.feedback?.comment || "Low rating, no comment left.")}
      </div>
      {resolved ? (
        order.complaintNote && (
          <div style={{ color: C.green }} className="text-xs">✓ Resolved: {order.complaintNote}</div>
        )
      ) : (
        <div className="flex gap-2 mt-2">
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="Resolution note (optional)…"
            style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.text }}
            className="flex-1 rounded-lg px-3 py-1.5 text-xs outline-none placeholder:text-slate-600" />
          <button onClick={() => onResolve(order, note)} style={{ background: C.green, color: "#fff" }}
            className="rounded-lg px-3 py-1.5 text-xs font-bold whitespace-nowrap">✓ Resolve</button>
        </div>
      )}
    </div>
  );
}

// ─── Promotions View ────────────────────────────────────────────────────────────
// Promo codes live in Firestore at config/promotions, read by the WhatsApp/web
// ordering flow. This view lets the owner create, toggle, and delete codes.

type PromoCode = {
  code: string; description: string;
  type: "PERCENT" | "FIXED" | "FREE_ITEM";
  value?: number; freeItemId?: string; minOrder?: number; active: boolean;
};

function PromotionsView() {
  const [promos, setPromos] = useState<PromoCode[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newPromo, setNewPromo] = useState<Partial<PromoCode>>({ type: "PERCENT", active: true });
  const [saveMsg, setSaveMsg] = useState("");

  useEffect(() => {
    const ref = doc(db, "config", "promotions");
    const unsub = onSnapshot(ref, snap => {
      if (snap.exists()) {
        const d = snap.data();
        setPromos(Array.isArray(d.codes) ? d.codes : []);
      }
      setLoaded(true);
    }, () => setLoaded(true));
    return () => unsub();
  }, []);

  function persist(next: PromoCode[]) {
    setPromos(next);
    const ref = doc(db, "config", "promotions");
    updateDoc(ref, { codes: next, updatedAt: serverTimestamp() })
      .catch(() => setDoc(ref, { codes: next, updatedAt: serverTimestamp() }));
    setSaveMsg("✓ Saved"); setTimeout(() => setSaveMsg(""), 2000);
  }

  function addPromo() {
    if (!newPromo.code || !newPromo.description) { alert("Enter a code and description."); return; }
    const promo: PromoCode = {
      code: newPromo.code.toUpperCase(), description: newPromo.description,
      type: newPromo.type || "PERCENT", value: newPromo.value, freeItemId: newPromo.freeItemId,
      minOrder: newPromo.minOrder, active: true,
    };
    persist([...promos, promo]);
    setNewPromo({ type: "PERCENT", active: true }); setShowAdd(false);
  }

  function toggleActive(code: string) {
    persist(promos.map(p => p.code === code ? { ...p, active: !p.active } : p));
  }

  function deletePromo(code: string) {
    if (!confirm(`Delete promo code ${code}?`)) return;
    persist(promos.filter(p => p.code !== code));
  }

  if (!loaded) return <div style={{ color: C.muted }} className="p-8 text-center text-sm">Loading promotions…</div>;

  return (
    <section className="space-y-5">
      <SectionHeader title="🎁 Promotions" sub={`${promos.filter(p => p.active).length} active · ${promos.length} total codes`} />

      <Card className="p-4">
        <div className="flex items-center justify-between">
          <button onClick={() => setShowAdd(v => !v)} style={{ background: "#8B5CF6", color: "#fff" }}
            className="rounded-xl px-4 py-2.5 text-sm font-bold">{showAdd ? "Cancel" : "+ New Promo Code"}</button>
          {saveMsg && <span style={{ color: C.green }} className="text-xs font-bold">{saveMsg}</span>}
        </div>

        {showAdd && (
          <div className="mt-4 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <input value={newPromo.code || ""} onChange={e => setNewPromo(p => ({ ...p, code: e.target.value }))}
                placeholder="CODE (e.g. SAVE10)" style={{ background: C.surf, border: `1px solid ${C.border}`, color: C.text }}
                className="rounded-xl px-3 py-2.5 text-sm outline-none placeholder:text-slate-600" />
              <select value={newPromo.type} onChange={e => setNewPromo(p => ({ ...p, type: e.target.value as PromoCode["type"] }))}
                style={{ background: C.surf, border: `1px solid ${C.border}`, color: C.text }}
                className="rounded-xl px-3 py-2.5 text-sm outline-none">
                <option value="PERCENT">Percent off</option>
                <option value="FIXED">Fixed $ off</option>
                <option value="FREE_ITEM">Free item</option>
              </select>
            </div>
            <input value={newPromo.description || ""} onChange={e => setNewPromo(p => ({ ...p, description: e.target.value }))}
              placeholder="Description (e.g. 10% off your first order)" style={{ background: C.surf, border: `1px solid ${C.border}`, color: C.text }}
              className="w-full rounded-xl px-3 py-2.5 text-sm outline-none placeholder:text-slate-600" />
            <div className="grid gap-3 sm:grid-cols-2">
              {newPromo.type !== "FREE_ITEM" ? (
                <input type="number" value={newPromo.value || ""} onChange={e => setNewPromo(p => ({ ...p, value: Number(e.target.value) }))}
                  placeholder={newPromo.type === "PERCENT" ? "Percent (e.g. 10)" : "Dollar amount (e.g. 5)"}
                  style={{ background: C.surf, border: `1px solid ${C.border}`, color: C.text }}
                  className="rounded-xl px-3 py-2.5 text-sm outline-none placeholder:text-slate-600" />
              ) : (
                <input value={newPromo.freeItemId || ""} onChange={e => setNewPromo(p => ({ ...p, freeItemId: e.target.value }))}
                  placeholder="Free item ID (e.g. fries)" style={{ background: C.surf, border: `1px solid ${C.border}`, color: C.text }}
                  className="rounded-xl px-3 py-2.5 text-sm outline-none placeholder:text-slate-600" />
              )}
              <input type="number" value={newPromo.minOrder || ""} onChange={e => setNewPromo(p => ({ ...p, minOrder: Number(e.target.value) }))}
                placeholder="Minimum order $ (optional)" style={{ background: C.surf, border: `1px solid ${C.border}`, color: C.text }}
                className="rounded-xl px-3 py-2.5 text-sm outline-none placeholder:text-slate-600" />
            </div>
            <button onClick={addPromo} style={{ background: C.green, color: "#fff" }} className="rounded-xl px-4 py-2.5 text-sm font-bold">Create Code</button>
          </div>
        )}
      </Card>

      <Card className="p-4">
        <div className="space-y-2">
          {promos.length ? promos.map(p => (
            <div key={p.code} style={{ background: C.surf, border: `1px solid ${C.border}` }}
              className="rounded-xl p-4 flex items-center justify-between gap-3 flex-wrap">
              <div>
                <div className="flex items-center gap-2">
                  <span style={{ color: "#8B5CF6" }} className="text-sm font-black tracking-wide">{p.code}</span>
                  <span style={{ background: p.active ? C.green : C.muted, color: "#fff" }} className="rounded-full px-2 py-0.5 text-[10px] font-bold">
                    {p.active ? "ACTIVE" : "INACTIVE"}
                  </span>
                </div>
                <div style={{ color: C.muted }} className="text-xs mt-1">{p.description}</div>
                {p.minOrder ? <div style={{ color: C.muted }} className="text-xs mt-0.5">Min order: {fmt(p.minOrder)}</div> : null}
              </div>
              <div className="flex gap-2">
                <button onClick={() => toggleActive(p.code)} style={{ background: C.card, color: C.text, border: `1px solid ${C.border}` }}
                  className="rounded-lg px-3 py-1.5 text-xs font-bold">{p.active ? "Deactivate" : "Activate"}</button>
                <button onClick={() => deletePromo(p.code)} style={{ background: C.card, color: C.red, border: `1px solid ${C.border}` }}
                  className="rounded-lg px-3 py-1.5 text-xs font-bold">Delete</button>
              </div>
            </div>
          )) : <Empty icon="🎁" text="No promo codes yet. Create one above." />}
        </div>
      </Card>
    </section>
  );
}

// ─── Customer Detail Modal ────────────────────────────────────────────────────

function CustomerDetailModal({ customer, onClose, onOrderClick }: {
  customer: CustomerSummary; onClose: () => void; onOrderClick: (o: OnlineOrder) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background:"rgba(0,0,0,0.88)" }} onClick={onClose}>
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div style={{ background:C.card, border:`1px solid ${C.border}` }} className="rounded-3xl overflow-hidden">
          <div style={{ height:4, background:`linear-gradient(90deg,${C.pink},${C.indigo})` }} />
          <div style={{ borderBottom:`1px solid ${C.border}` }} className="flex items-center justify-between p-6">
            <div>
              <div style={{ color:C.text }} className="text-xl font-black">{customer.name}</div>
              <div style={{ color:C.muted }} className="text-sm">📞 {customer.phone}</div>
            </div>
            <div className="flex items-center gap-2">
              <Pill color={customer.segment==="VIP"?C.amber:customer.segment==="Regular"?C.indigo:C.muted}>{customer.segment}</Pill>
              <button onClick={onClose}
                style={{ background:C.surf, color:C.muted, border:`1px solid ${C.border}` }}
                className="h-9 w-9 rounded-xl flex items-center justify-center text-xl font-bold hover:opacity-80">×</button>
            </div>
          </div>
          <div className="p-6 space-y-5">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label:"Orders",    value:customer.orders,                 accent:C.indigo },
                { label:"Revenue",   value:fmt(customer.revenue),           accent:C.green  },
                { label:"Avg Order", value:fmt(customer.averageOrderValue), accent:C.amber  },
                { label:"Cancelled", value:customer.cancelledOrders,        accent:C.red    },
              ].map(k => (
                <div key={k.label} style={{ background:k.accent+"15", border:`1px solid ${k.accent}33` }} className="rounded-xl p-3 text-center">
                  <div style={{ color:k.accent }} className="text-lg font-black">{k.value}</div>
                  <div style={{ color:C.muted }} className="text-xs">{k.label}</div>
                </div>
              ))}
            </div>

            <div style={{ background:C.surf, border:`1px solid ${C.border}` }} className="rounded-2xl p-4 space-y-2">
              <div style={{ color:C.green }} className="text-xs font-black uppercase tracking-widest mb-2">Contact Info</div>
              <div style={{ color:C.text }} className="text-sm">
                📞 <a href={`tel:${customer.phone}`} style={{ color:C.green }} className="font-bold underline">{customer.phone}</a>
              </div>
              <div style={{ color:C.muted }} className="text-xs">
                First order: {fmtDate(customer.firstOrderAt)}<br />Last order: {fmtDate(customer.lastOrderAt)}
              </div>
              {customer.favouriteItems.length > 0 && (
                <div className="pt-2">
                  <div style={{ color:C.muted }} className="text-xs mb-1.5">Favourite items:</div>
                  <div className="flex flex-wrap gap-1.5">
                    {customer.favouriteItems.map(i => <Pill key={i} color={C.indigo}>{i}</Pill>)}
                  </div>
                </div>
              )}
            </div>

            <div>
              <div style={{ color:C.muted }} className="text-xs font-black uppercase tracking-widest mb-3">
                Order History ({customer.allOrders.length})
              </div>
              <div className="space-y-2">
                {[...customer.allOrders].sort((a,b)=>(toDate(b.createdAt)?.getTime()||0)-(toDate(a.createdAt)?.getTime()||0))
                  .map(o => (
                  <button key={o.orderId} onClick={() => { onClose(); onOrderClick(o); }}
                    style={{ background:C.surf, border:`1px solid ${C.border}` }}
                    className="w-full text-left flex items-center justify-between rounded-xl px-4 py-3 hover:border-orange-500 transition-all">
                    <div>
                      <div style={{ color:C.muted }} className="text-xs font-mono">{o.orderId?.substring(0,16)}…</div>
                      <div style={{ color:C.muted }} className="text-xs">{fmtDate(o.createdAt)}</div>
                      {o.feedback?.rating && (
                        <div className="mt-1">
                          <Stars rating={o.feedback.rating} />
                          {o.feedback.comment && (
                            <p style={{ color:C.muted }} className="text-xs italic mt-0.5">
                              "{o.feedback.comment.substring(0,60)}{o.feedback.comment.length>60?"…":""}"
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="text-right ml-4">
                      <div style={{ color:C.accent }} className="text-sm font-black">{fmt(getTotal(o))}</div>
                      <div className="mt-1"><Badge status={o.status} /></div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Customers ────────────────────────────────────────────────────────────────

function CustomersView({ customers, onOrderClick }: {
  customers: CustomerSummary[]; onOrderClick: (o: OnlineOrder) => void;
}) {
  const [selected, setSelected] = useState<CustomerSummary|null>(null);
  const [search, setSearch]     = useState("");
  const [seg, setSeg]           = useState<"ALL"|CustomerSegment>("ALL");
  const totalRev    = customers.reduce((s,c)=>s+c.revenue, 0);
  const returning   = customers.filter(c=>c.segment!=="New").length;

  const filtered = customers.filter(c =>
    (c.name.toLowerCase().includes(search.toLowerCase()) || c.phone.includes(search)) &&
    (seg==="ALL"||c.segment===seg)
  );

  return (
    <section className="space-y-5">
      {selected && <CustomerDetailModal customer={selected} onClose={() => setSelected(null)} onOrderClick={onOrderClick} />}

      <div className="flex items-start justify-between flex-wrap gap-3">
        <SectionHeader title="👥 Customers" sub="Tap any customer to view profile, history & feedback" />
        <button onClick={() => exportCSV(customers)}
          style={{ background:C.green+"22", color:C.green, border:`1px solid ${C.green}44` }}
          className="rounded-xl px-4 py-2 text-xs font-bold hover:opacity-80 whitespace-nowrap">⬇ Export CSV</button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Total Customers" value={String(customers.length)}                                    accent={C.indigo} icon="👥" />
        <KpiCard label="Returning"       value={String(returning)}                                           accent={C.green}  icon="🔄" />
        <KpiCard label="VIP"             value={String(customers.filter(c=>c.segment==="VIP").length)}       accent={C.amber}  icon="⭐" />
        <KpiCard label="Total Revenue"   value={fmt(totalRev)}                                               accent={C.pink}   icon="💰" />
      </div>

      <Card className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search by name or phone…"
            style={{ background:C.surf, border:`1px solid ${C.border}`, color:C.text }}
            className="w-full rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-orange-500 placeholder:text-slate-600" />
          <div className="flex gap-2">
            {(["ALL","New","Regular","VIP"] as const).map(s => (
              <button key={s} onClick={() => setSeg(s)}
                style={seg===s ? { background:C.indigo, color:"#fff" } : { background:C.surf, color:C.muted, border:`1px solid ${C.border}` }}
                className="rounded-xl px-3 py-2 text-xs font-bold whitespace-nowrap">{s}</button>
            ))}
          </div>
        </div>
      </Card>

      <div className="space-y-2">
        {filtered.length ? filtered.map(c => (
          <button key={c.phone} onClick={() => setSelected(c)}
            style={{ background:C.card, border:`1px solid ${C.border}` }}
            className="w-full text-left rounded-2xl p-4 hover:border-orange-500 transition-all group">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span style={{ color:C.text }} className="font-bold">{c.name}</span>
                  <Pill color={c.segment==="VIP"?C.amber:c.segment==="Regular"?C.indigo:C.muted}>{c.segment}</Pill>
                </div>
                <div style={{ color:C.muted }} className="text-sm mt-0.5">📞 {c.phone}</div>
                <div style={{ color:C.muted }} className="text-xs mt-1">Last order: {fmtDate(c.lastOrderAt)}</div>
                {c.favouriteItems.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {c.favouriteItems.map(i => <Pill key={i} color={C.indigo}>{i}</Pill>)}
                  </div>
                )}
              </div>
              <div className="text-right">
                <div style={{ color:C.accent }} className="font-black">{c.orders} orders</div>
                <div style={{ color:C.green }} className="text-sm font-bold">{fmt(c.revenue)}</div>
                <div style={{ color:C.muted }} className="text-xs">avg {fmt(c.averageOrderValue)}</div>
                {c.cancelledOrders > 0 && <div style={{ color:C.red }} className="text-xs">{c.cancelledOrders} cancelled</div>}
                <div style={{ color:C.indigo }} className="text-xs font-semibold mt-1">View profile →</div>
              </div>
            </div>
          </button>
        )) : <Card className="p-12"><Empty icon="👥" text="No customers match your search." /></Card>}
      </div>
    </section>
  );
}

// ─── Reports ──────────────────────────────────────────────────────────────────

function ReportsView({ orders }: { orders: OnlineOrder[] }) {
  const [preset, setPreset] = useState<DateRangePreset>("DAILY");
  const [from, setFrom]     = useState("");
  const [to, setTo]         = useState("");

  const filtered   = useMemo(() => orders.filter(o => dateInRange(o.createdAt,preset,from,to)), [orders,preset,from,to]);
  const sale        = filtered.reduce((s,o)=>s+getSale(o), 0);
  const cancelled   = filtered.filter(o=>normStatus(o.status)==="CANCELLED");
  const cancelVal   = cancelled.reduce((s,o)=>s+getTotal(o), 0);
  const delivery    = filtered.filter(o=>!isPickupOrder(o));
  const pickup      = filtered.filter(o=>isPickupOrder(o));
  const itemSales   = aggregateItems(filtered);
  const avgVal      = filtered.length ? sale/filtered.length : 0;
  const feedbacks   = filtered.filter(o=>o.feedback?.rating);
  const avgRating   = feedbacks.length ? feedbacks.reduce((s,o)=>s+(o.feedback?.rating||0),0)/feedbacks.length : 0;

  return (
    <section className="space-y-6">
      <SectionHeader title="📊 Reports & Analytics" />

      <Card className="p-4">
        <div className="flex flex-wrap gap-2">
          {(["DAILY","WEEKLY","MONTHLY","CUSTOM"] as DateRangePreset[]).map(p => (
            <button key={p} onClick={() => setPreset(p)}
              style={preset===p ? { background:C.indigo, color:"#fff" } : { background:C.surf, color:C.muted, border:`1px solid ${C.border}` }}
              className="rounded-xl px-4 py-2 text-xs font-bold">{p}</button>
          ))}
        </div>
        {preset==="CUSTOM" && (
          <div className="mt-3 flex flex-wrap gap-3">
            <input type="date" value={from} onChange={e=>setFrom(e.target.value)}
              style={{ background:C.surf, border:`1px solid ${C.border}`, color:C.text }}
              className="rounded-xl px-3 py-2 text-sm outline-none" />
            <input type="date" value={to} onChange={e=>setTo(e.target.value)}
              style={{ background:C.surf, border:`1px solid ${C.border}`, color:C.text }}
              className="rounded-xl px-3 py-2 text-sm outline-none" />
          </div>
        )}
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Net Sales"       value={fmt(sale)}           accent={C.green}  icon="💰" />
        <KpiCard label="Cancelled Value" value={fmt(cancelVal)}      sub={`${cancelled.length} orders`} accent={C.red} icon="✕" />
        <KpiCard label="Total Orders"    value={String(filtered.length)} accent={C.indigo} icon="📋" />
        <KpiCard label="Avg Order"       value={fmt(avgVal)}         accent={C.amber}  icon="📊" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Delivery"        value={String(delivery.length)}  accent={C.cyan}   icon="🛵" />
        <KpiCard label="Pickup"          value={String(pickup.length)}    accent={C.purple} icon="🏠" />
        <KpiCard label="With Feedback"   value={String(feedbacks.length)} accent={C.pink}   icon="⭐" />
        <KpiCard label="Avg Rating"      value={avgRating ? avgRating.toFixed(1)+"★" : "—"} accent={C.amber} icon="🌟" />
      </div>

      {feedbacks.length > 0 && (
        <Card className="p-5">
          <h3 style={{ color:C.text }} className="mb-4 text-base font-black">Customer Reviews</h3>
          <div className="space-y-3">
            {[...feedbacks].sort((a,b)=>(toDate(b.feedback?.submittedAt)?.getTime()||0)-(toDate(a.feedback?.submittedAt)?.getTime()||0))
              .map(o => (
              <div key={o.orderId} style={{ background:C.surf, border:`1px solid ${C.border}` }} className="rounded-xl p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex-1">
                    <div style={{ color:C.text }} className="font-semibold text-sm">
                      {o.deliveryInfo?.name||o.customer?.name||o.customerName||"Unknown"}
                    </div>
                    <div style={{ color:C.muted }} className="text-xs">{o.deliveryInfo?.phone||o.customerPhone||"—"}</div>
                    <div className="mt-2"><Stars rating={o.feedback?.rating||0} /></div>
                    {o.feedback?.comment && (
                      <div style={{ background:C.card, border:`1px solid ${C.border}` }} className="mt-2 rounded-xl p-3">
                        <p style={{ color:C.text }} className="text-sm italic">"{o.feedback.comment}"</p>
                      </div>
                    )}
                    <div style={{ color:C.muted }} className="mt-1 text-xs">{fmtDate(o.feedback?.submittedAt)}</div>
                  </div>
                  <div style={{ color:C.accent }} className="text-sm font-black whitespace-nowrap">{fmt(getTotal(o))}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="p-5">
        <h3 style={{ color:C.text }} className="mb-4 text-base font-black">Top Selling Items</h3>
        <div className="space-y-2">
          {itemSales.length ? itemSales.slice(0,15).map((item, idx) => (
            <div key={item.name} style={{ background:C.surf, border:`1px solid ${C.border}` }}
              className="flex items-center justify-between rounded-xl px-4 py-3">
              <div className="flex items-center gap-3">
                <span style={{ color:C.muted }} className="text-sm font-black w-6">#{idx+1}</span>
                <div>
                  <div style={{ color:C.text }} className="text-sm font-semibold">{item.name}</div>
                  <div style={{ color:C.muted }} className="text-xs">Qty sold: {item.qty}</div>
                </div>
              </div>
              <div style={{ color:C.green }} className="text-sm font-black">{fmt(item.sales)}</div>
            </div>
          )) : <Empty icon="🍔" text="No sales data for this period." />}
        </div>
      </Card>
    </section>
  );
}

// ─── Menu Manager ─────────────────────────────────────────────────────────────

const DEFAULT_MENU: MenuItem[] = [
  { id:"zinger_classic",  name:"Classic Zinger",         category:"Zingers",    price:399,  available:true, badge:"🔥 Best Seller" },
  { id:"zinger_mayo",     name:"Creamy Mayo Zinger",     category:"Zingers",    price:399,  available:true },
  { id:"zinger_bbq",      name:"BBQ Zinger",             category:"Zingers",    price:399,  available:true },
  { id:"zinger_cheese",   name:"Zinger Cheese",          category:"Zingers",    price:479,  available:true },
  { id:"zinger_dynamite", name:"Dynamite Zinger",        category:"Zingers",    price:499,  available:true, badge:"🌶️ Spicy" },
  { id:"zinger_jalapeno", name:"Jalapeno Zinger",        category:"Zingers",    price:499,  available:true },
  { id:"chicken_classic", name:"Classic Chicken",        category:"Chicken",    price:269,  available:true },
  { id:"chicken_cheese",  name:"Chicken Cheese",         category:"Chicken",    price:319,  available:true },
  { id:"chicken_smoky",   name:"Smoky Chicken",          category:"Chicken",    price:319,  available:true },
  { id:"chicken_dynamite",name:"Dynamite Chicken",       category:"Chicken",    price:349,  available:true },
  { id:"chicken_sgrll",   name:"Smoky Grilled",          category:"Chicken",    price:349,  available:true },
  { id:"chicken_dgrll",   name:"Dynamite Grilled",       category:"Chicken",    price:399,  available:true },
  { id:"chicken_mgrll",   name:"Mushroom Grilled",       category:"Chicken",    price:399,  available:true },
  { id:"beef_classic",    name:"Classic Beef",           category:"Beef",       price:399,  available:true },
  { id:"beef_mayo",       name:"Mayo Beef",              category:"Beef",       price:449,  available:true },
  { id:"beef_smoky",      name:"Smoky Beef",             category:"Beef",       price:449,  available:true },
  { id:"beef_mushroom",   name:"Mushroom Beef",          category:"Beef",       price:499,  available:true },
  { id:"beef_dynamite",   name:"Dynamite Beef",          category:"Beef",       price:499,  available:true, badge:"🌶️ Spicy" },
  { id:"sand_grilled",    name:"Grilled Club",           category:"Sandwiches", price:449,  available:true },
  { id:"sand_jalapeno",   name:"Jalapeno Sandwich",      category:"Sandwiches", price:449,  available:true },
  { id:"sand_fajita",     name:"Fajita Sandwich",        category:"Sandwiches", price:499,  available:true },
  { id:"sand_crispy",     name:"Crispy Sandwich",        category:"Sandwiches", price:449,  available:true },
  { id:"sand_club",       name:"Stack & Slice Special Club",  category:"Sandwiches", price:549,  available:true, badge:"⭐ Special" },
  { id:"prem_dynbeef2",   name:"Dynamite Beef Double",   category:"Premium",    price:669,  available:true },
  { id:"prem_mushbeef2",  name:"Mushroom Beef Double",   category:"Premium",    price:669,  available:true },
  { id:"prem_cheese",     name:"Cheese Rocker",          category:"Premium",    price:669,  available:true },
  { id:"prem_animal",     name:"Animal Style",           category:"Premium",    price:669,  available:true },
  { id:"prem_mega",       name:"Mega Zinger",            category:"Premium",    price:669,  available:true },
  { id:"prem_wanted",     name:"Most Wanted",            category:"Premium",    price:849,  available:true, badge:"🔥 Premium" },
  { id:"wing6",           name:"Crispy Wings 6pcs",      category:"Broast",     price:399,  available:true },
  { id:"wing12",          name:"Crispy Wings 12pcs",     category:"Broast",     price:769,  available:true },
  { id:"broast_chest",    name:"Quarter Broast Chest 2pc",category:"Broast",    price:499,  available:true },
  { id:"broast_leg",      name:"Quarter Broast Leg 2pc", category:"Broast",     price:479,  available:true },
  { id:"broast_half",     name:"Half Broast 4pcs",       category:"Broast",     price:949,  available:true },
  { id:"broast_full",     name:"Full Broast 8pcs",       category:"Broast",     price:1849, available:true },
  { id:"combo1", name:"Combo 1 — Classic Treat",       category:"Deals", price:699,  available:true, badge:"🔥 Hot" },
  { id:"combo2", name:"Combo 2 — Chicken Lover",       category:"Deals", price:729,  available:true },
  { id:"combo3", name:"Combo 3 — Zinger Duo",          category:"Deals", price:1049, available:true },
  { id:"combo4", name:"Combo 4 — Zinger & Broast",     category:"Deals", price:1429, available:true },
  { id:"combo5", name:"Combo 5 — Wings & Fries",       category:"Deals", price:569,  available:true },
  { id:"combo6", name:"Combo 6 — Zinger Party Pack",   category:"Deals", price:2149, available:true, badge:"👨‍👩‍👧‍👦 Party" },
  { id:"combo7", name:"Combo 7 — Grilled & Crunchy",   category:"Deals", price:1299, available:true },
  { id:"combo8", name:"Combo 8 — Friends & Family",    category:"Deals", price:2849, available:true, badge:"🎉 Large" },
  { id:"fries_reg",  name:"Regular Fries",     category:"Sides",     price:99,  available:true },
  { id:"fries_mayo", name:"Mayo Garlic Fries", category:"Sides",     price:149, available:true },
  { id:"bev_345",    name:"Pepsi/7up/Dew 345ml",category:"Beverages",price:90,  available:true },
  { id:"bev_500",    name:"Pepsi/7up/Dew 500ml",category:"Beverages",price:120, available:true },
  { id:"bev_1l",     name:"7up/Pepsi 1L",      category:"Beverages", price:170, available:true },
  { id:"bev_1_5l",   name:"7up/Pepsi 1.5L",    category:"Beverages", price:230, available:true },
  { id:"bev_sting",  name:"Sting 345ml",        category:"Beverages", price:100, available:true },
];

function MenuManagerView() {
  const [items, setItems]     = useState<MenuItem[]>(DEFAULT_MENU);
  const [loaded, setLoaded]   = useState(false);
  const [editId, setEditId]   = useState<string|null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newItem, setNewItem] = useState<Partial<MenuItem>>({ category:"Zingers", available:true });
  const [saveMsg, setSaveMsg] = useState("");

  useEffect(() => {
    const ref = doc(db, "config", "menuItems");
    const unsub = onSnapshot(ref, snap => {
      if (snap.exists()) {
        const d = snap.data(); const fs: MenuItem[] = Array.isArray(d.items) ? d.items : [];
        if (fs.length > 0) setItems(fs);
      }
      setLoaded(true);
    }, () => setLoaded(true));
    return () => unsub();
  }, []);

  function persist(next: MenuItem[]) {
    setItems(next);
    const ref = doc(db, "config", "menuItems");
    updateDoc(ref, { items:next, updatedAt:serverTimestamp() })
      .catch(() => setDoc(ref, { items:next, updatedAt:serverTimestamp() }));
    setSaveMsg("✓ Saved to Firestore"); setTimeout(() => setSaveMsg(""), 2500);
  }

  function addItem() {
    if (!newItem.name||!newItem.price||!newItem.category) { alert("Fill name, price and category."); return; }
    const id = newItem.name.toLowerCase().replace(/\s+/g,"_")+"_"+Date.now();
    persist([...items, { id, name:newItem.name!, category:newItem.category!, price:Number(newItem.price), available:newItem.available??true, badge:newItem.badge }]);
    setNewItem({ category:"Zingers", available:true }); setShowAdd(false);
  }

  const cats      = [...new Set(items.map(i => i.category))];
  const outStock  = items.filter(i => !i.available).length;
  if (!loaded) return <Card className="p-10 text-center"><span style={{ color:C.muted }}>Loading menu from Firestore…</span></Card>;

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionHeader title="🍽️ Menu Manager" sub={`${items.length} items · ${outStock} out of stock · click name/price to edit inline`} />
        <div className="flex items-center gap-3">
          {saveMsg && <span style={{ color:C.green }} className="text-sm font-bold">{saveMsg}</span>}
          <button onClick={() => setShowAdd(true)}
            style={{ background:"linear-gradient(135deg,#F97316,#EF4444)" }}
            className="rounded-xl px-5 py-2.5 text-sm font-bold text-white hover:opacity-90">+ Add Item</button>
        </div>
      </div>

      {showAdd && (
        <Card className="p-6">
          <h3 style={{ color:C.text }} className="mb-4 text-base font-black">New Menu Item</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <FInput label="Name *" value={newItem.name||""} onChange={e=>setNewItem({...newItem,name:e.target.value})} placeholder="e.g. Spicy Zinger" />
            <FInput label="Price (Rs.) *" type="number" value={String(newItem.price||"")} onChange={e=>setNewItem({...newItem,price:Number(e.target.value)})} placeholder="550" />
            <FInput label="Category *" value={newItem.category||""} onChange={e=>setNewItem({...newItem,category:e.target.value})} placeholder="Zingers / Deals" />
            <FInput label="Badge (optional)" value={newItem.badge||""} onChange={e=>setNewItem({...newItem,badge:e.target.value})} placeholder="🔥 Hot" />
            <div className="flex items-center gap-3">
              <span style={{ color:C.muted }} className="text-sm font-semibold">Available on launch</span>
              <Toggle on={!!newItem.available} onToggle={() => setNewItem({...newItem,available:!newItem.available})} />
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <button onClick={addItem} style={{ background:C.green, color:"#fff" }} className="rounded-xl px-5 py-2.5 text-sm font-bold hover:opacity-90">Add to Menu</button>
            <button onClick={() => setShowAdd(false)}
              style={{ background:C.surf, color:C.muted, border:`1px solid ${C.border}` }}
              className="rounded-xl px-5 py-2.5 text-sm font-bold">Cancel</button>
          </div>
        </Card>
      )}

      {cats.map(cat => (
        <div key={cat}>
          <div className="mb-3 flex items-center gap-3">
            <div style={{ background:C.border }} className="h-px flex-1" />
            <span style={{ background:C.accent+"22", color:C.accent, border:`1px solid ${C.accent}44` }}
              className="rounded-full px-3 py-1 text-xs font-black whitespace-nowrap">
              {cat} ({items.filter(i=>i.category===cat).length})
            </span>
            <div style={{ background:C.border }} className="h-px flex-1" />
          </div>
          <div className="space-y-2">
            {items.filter(i=>i.category===cat).map(item => (
              <Card key={item.id} className={`p-4 transition-all ${!item.available ? "opacity-40" : ""}`}>
                <div className="flex flex-wrap items-center gap-4">
                  <div style={{ background:C.surf, border:`1px solid ${C.border}` }}
                    className="flex h-11 w-11 items-center justify-center rounded-xl text-xl flex-shrink-0">
                    {["Zingers","Chicken","Beef","Premium"].includes(cat)?"🍔":cat==="Sandwiches"?"🥪":cat==="Broast"?"🍗":cat==="Deals"?"🎁":cat==="Beverages"?"🥤":"🍟"}
                  </div>
                  <div className="flex-1 min-w-[160px]">
                    {editId===item.id+"_name" ? (
                      <input autoFocus defaultValue={item.name}
                        onBlur={e => { persist(items.map(i=>i.id===item.id?{...i,name:e.target.value}:i)); setEditId(null); }}
                        onKeyDown={e => { if(e.key==="Enter")(e.target as HTMLInputElement).blur(); }}
                        style={{ background:C.surf, border:`1px solid ${C.indigo}`, color:C.text }}
                        className="w-full rounded-lg px-2 py-1 text-sm font-bold outline-none" />
                    ) : (
                      <button onClick={() => setEditId(item.id+"_name")} style={{ color:C.text }}
                        className="text-left text-sm font-bold hover:opacity-70 flex items-center gap-1">
                        {item.name} <span style={{ color:C.muted }} className="text-xs">✏️</span>
                      </button>
                    )}
                    {item.badge && <Pill color={C.accent}>{item.badge}</Pill>}
                  </div>
                  <div className="text-center">
                    <div style={{ color:C.muted }} className="text-xs font-bold mb-0.5">Price</div>
                    {editId===item.id+"_price" ? (
                      <input autoFocus type="number" defaultValue={item.price}
                        onBlur={e => { persist(items.map(i=>i.id===item.id?{...i,price:Number(e.target.value)}:i)); setEditId(null); }}
                        onKeyDown={e => { if(e.key==="Enter")(e.target as HTMLInputElement).blur(); }}
                        style={{ background:C.surf, border:`1px solid ${C.indigo}`, color:C.text }}
                        className="w-24 rounded-lg px-2 py-1 text-sm font-bold outline-none text-center" />
                    ) : (
                      <button onClick={() => setEditId(item.id+"_price")} style={{ color:C.accent }}
                        className="text-sm font-black hover:opacity-70 flex items-center gap-1">
                        Rs. {item.price} <span style={{ color:C.muted }} className="text-xs">✏️</span>
                      </button>
                    )}
                  </div>
                  <div className="text-center">
                    <div style={{ color:item.available?C.green:C.red }} className="text-xs font-bold mb-1">
                      {item.available ? "✓ Available" : "✗ Off"}
                    </div>
                    <Toggle on={item.available} onToggle={() => persist(items.map(i=>i.id===item.id?{...i,available:!i.available}:i))} />
                  </div>
                  <button onClick={() => { if(confirm("Delete this item?")) persist(items.filter(i=>i.id!==item.id)); }}
                    style={{ background:C.red+"22", color:C.red, border:`1px solid ${C.red}44` }}
                    className="rounded-xl px-3 py-2 text-xs font-bold hover:opacity-80">Delete</button>
                </div>
              </Card>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

// ─── Settings ─────────────────────────────────────────────────────────────────

function SettingsView({ role }: { role: AppRole }) {
  const [saved, setSaved] = useState(false);
  const [settings, setSettings] = useState({
    restaurantName:    "Stack & Slice",
    phone:             "+1 718 555 0199",
    whatsapp:          "+1 718 555 0199",
    address:           "412 Atlantic Ave, Brooklyn, NY 11217",
    city:              "Brooklyn",
    openingTime:       "11:00",
    closingTime:       "01:00",
    deliveryRadius:    "5",
    freeDeliveryAbove: "35",
    deliveryCharge:    "2.99",
    minOrderAmount:    "12",
    taxPercent:        "8.875",
  });

  useEffect(() => {
    const ref = doc(db, "config", "settings");
    const unsub = onSnapshot(ref, snap => {
      if (snap.exists()) setSettings(prev => ({ ...prev, ...snap.data() }));
    });
    return () => unsub();
  }, []);

  async function save() {
    try {
      await setDoc(doc(db, "config", "settings"), { ...settings, updatedAt: serverTimestamp() }, { merge: true });
      setSaved(true); setTimeout(() => setSaved(false), 3000);
    } catch (e) { alert("Save failed: " + (e as Error).message); }
  }

  type SettingsKey = keyof typeof settings;
  const fields: { key: SettingsKey; label: string; type?: string; col?: number }[] = [
    { key:"restaurantName",    label:"Restaurant Name",           col:2 },
    { key:"phone",             label:"Phone Number" },
    { key:"whatsapp",          label:"WhatsApp Number" },
    { key:"address",           label:"Address",                   col:2 },
    { key:"city",              label:"City" },
    { key:"openingTime",       label:"Opening Time",  type:"time" },
    { key:"closingTime",       label:"Closing Time",  type:"time" },
    { key:"deliveryRadius",    label:"Delivery Radius (miles)" },
    { key:"deliveryCharge",    label:"Delivery Charge ($)" },
    { key:"freeDeliveryAbove", label:"Free Delivery Above ($)" },
    { key:"minOrderAmount",    label:"Min Order Amount ($)" },
    { key:"taxPercent",        label:"Tax %" },
  ];

  // ── Clear All Demo Data ─────────────────────────────────────────────────
  // Wipes the "orders" and "feedback" collections only. config/menuItems and
  // config/promotions are left untouched — those are restaurant setup, not
  // per-demo session data, and clearing them would break the menu instead
  // of resetting it. Used to reset the shared demo between prospect calls.
  const [clearStep, setClearStep] = useState<"idle" | "confirm" | "clearing" | "done">("idle");
  const [clearTyped, setClearTyped] = useState("");
  const [clearCounts, setClearCounts] = useState<{ orders: number; feedback: number } | null>(null);

  async function startClear() {
    setClearStep("confirm");
    setClearTyped("");
    try {
      const [ordersSnap, feedbackSnap] = await Promise.all([
        getDocs(collection(db, "orders")),
        getDocs(collection(db, "feedback")),
      ]);
      setClearCounts({ orders: ordersSnap.size, feedback: feedbackSnap.size });
    } catch (e) {
      setClearCounts({ orders: 0, feedback: 0 });
    }
  }

  async function runClear() {
    setClearStep("clearing");
    try {
      const [ordersSnap, feedbackSnap] = await Promise.all([
        getDocs(collection(db, "orders")),
        getDocs(collection(db, "feedback")),
      ]);
      const allRefs = [...ordersSnap.docs.map(d => d.ref), ...feedbackSnap.docs.map(d => d.ref)];
      // Firestore batched writes cap at 500 operations — chunk accordingly.
      for (let i = 0; i < allRefs.length; i += 500) {
        const batch = writeBatch(db);
        allRefs.slice(i, i + 500).forEach(ref => batch.delete(ref));
        await batch.commit();
      }
      setClearStep("done");
      setTimeout(() => { setClearStep("idle"); setClearCounts(null); }, 4000);
    } catch (e) {
      alert("Clear failed: " + (e as Error).message);
      setClearStep("idle");
    }
  }

  return (
    <section className="space-y-6">
      <SectionHeader title="⚙️ Settings" />

      {role !== "ADMIN" && (
        <div style={{ background:C.amber+"22", border:`1px solid ${C.amber}44`, color:C.amber }}
          className="rounded-xl px-4 py-3 text-sm font-semibold">
          ⚠️ Read-only — Admin access required to save changes.
        </div>
      )}

      <Card className="p-6">
        <h3 style={{ color:C.text }} className="text-base font-black mb-5">Restaurant Info</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          {fields.map(f => (
            <div key={f.key} className={f.col===2 ? "sm:col-span-2" : ""}>
              <FInput label={f.label} type={f.type||"text"}
                value={settings[f.key]}
                onChange={e => setSettings(p => ({ ...p, [f.key]: e.target.value }))}
                disabled={role !== "ADMIN"} />
            </div>
          ))}
        </div>
        {role === "ADMIN" && (
          <div className="mt-6 flex items-center gap-3">
            <button onClick={save}
              style={{ background:"linear-gradient(135deg,#F97316,#EF4444)" }}
              className="rounded-xl px-6 py-3 text-sm font-black text-white hover:opacity-90">
              Save Settings
            </button>
            {saved && <span style={{ color:C.green }} className="text-sm font-bold">✓ Saved to Firestore!</span>}
          </div>
        )}
      </Card>

      <Card className="p-6">
        <h3 style={{ color:C.text }} className="text-base font-black mb-4">Staff Access</h3>
        <div className="space-y-2">
          {ADMIN_EMAILS.map(e => (
            <div key={e} style={{ background:C.indigo+"22", border:`1px solid ${C.indigo}44`, color:C.indigo }}
              className="rounded-xl px-4 py-2.5 text-sm font-semibold flex items-center gap-2">
              👑 {e} — Admin
            </div>
          ))}
          {EMPLOYEE_EMAILS.map(e => (
            <div key={e} style={{ background:C.surf, border:`1px solid ${C.border}`, color:C.muted }}
              className="rounded-xl px-4 py-2.5 text-sm flex items-center gap-2">
              👤 {e} — Employee
            </div>
          ))}
        </div>
        <p style={{ color:C.muted }} className="text-xs mt-3">
          To add or remove staff, edit ADMIN_EMAILS / EMPLOYEE_EMAILS in page.tsx and redeploy.
        </p>
      </Card>

      {role === "ADMIN" && (
        <Card className="p-6" style={{ borderColor: "#4A1F1F" }}>
          <h3 style={{ color: "#FCA5A5" }} className="text-base font-black mb-2">⚠️ Danger Zone</h3>
          <p style={{ color: C.muted }} className="text-sm mb-4">
            Clears all orders, cancellations, and feedback so the demo looks fresh for the next prospect.
            Menu items and promo codes are kept — this only resets order/session data, not restaurant setup.
            This cannot be undone.
          </p>

          {clearStep === "idle" && (
            <button onClick={startClear} style={{ background: C.red, color: "#fff" }}
              className="rounded-xl px-5 py-3 text-sm font-black">
              Clear All Orders &amp; Feedback
            </button>
          )}

          {clearStep === "confirm" && (
            <div style={{ background: "#2D1212", border: "1px solid #4A1F1F" }} className="rounded-xl p-4 space-y-3">
              <div style={{ color: "#FED7D7" }} className="text-sm font-bold">
                This will permanently delete {clearCounts ? `${clearCounts.orders} orders and ${clearCounts.feedback} feedback entries` : "all order and feedback data"}.
              </div>
              <div style={{ color: C.muted }} className="text-xs">Type <b style={{ color:"#FCA5A5" }}>CLEAR</b> below to confirm.</div>
              <input value={clearTyped} onChange={e => setClearTyped(e.target.value)} placeholder="Type CLEAR"
                style={{ background: C.bg, border: "1px solid #4A1F1F", color: C.text }}
                className="w-full rounded-lg px-3 py-2 text-sm outline-none placeholder:text-slate-600" />
              <div className="flex gap-2">
                <button onClick={runClear} disabled={clearTyped !== "CLEAR"}
                  style={{ background: clearTyped === "CLEAR" ? C.red : C.surf, color: clearTyped === "CLEAR" ? "#fff" : C.muted }}
                  className="rounded-lg px-4 py-2 text-xs font-black disabled:cursor-not-allowed">
                  Permanently Delete
                </button>
                <button onClick={() => { setClearStep("idle"); setClearCounts(null); }}
                  style={{ background: C.surf, color: C.text, border: `1px solid ${C.border}` }}
                  className="rounded-lg px-4 py-2 text-xs font-bold">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {clearStep === "clearing" && (
            <div style={{ color: C.muted }} className="text-sm">⏳ Deleting…</div>
          )}

          {clearStep === "done" && (
            <div style={{ color: C.green }} className="text-sm font-bold">✓ All orders and feedback cleared. Demo is reset.</div>
          )}
        </Card>
      )}
    </section>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function FoodHubDashboard() {
  const [tab, setTab]           = useState<TabId>("dashboard");
  const [orders, setOrders]     = useState<OnlineOrder[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState("");
  const [busy, setBusy]         = useState<string|null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [user, setUser]         = useState<User|null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState<OnlineOrder|null>(null);

  // ── New / cancelled order alerts (blinking banner + repeating tone) ──────
  const [alerts, setAlerts] = useState<PendingAlert[]>([]);
  const knownStatusRef = useRef<Map<string,string>>(new Map());
  const firstSnapshotRef = useRef(true);
  const toneIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, u => { setUser(u); setAuthLoading(false); });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!user) { setOrders([]); setLoading(false); return; }
    setLoading(true);
    const q = query(collection(db, "orders"), orderBy("createdAt","desc"));
    const unsub = onSnapshot(q, snap => {
      const next: OnlineOrder[] = snap.docs.map(d => {
        const data = d.data() as DocumentData;
        const cust = data.customer || {};
        const del  = data.deliveryInfo || {};
        const merged: DeliveryAddress = {
          name:     del.name     || cust.name     || data.customerName || "",
          phone:    del.phone    || cust.phone    || data.phone || data.customerPhone || "",
          house:    del.house    || cust.house    || "",
          area:     del.area     || cust.area     || cust.address?.street || data.address || "",
          landmark: del.landmark || cust.landmark || "",
          notes:    del.notes    || cust.notes    || data.notes || "",
        };
        return {
          id: d.id, orderId: data.orderId || d.id,
          status: data.status, source: data.source,
          orderType: data.orderType || (merged.house ? "DELIVERY" : "PICKUP"),
          total: data.total, grandTotal: data.grandTotal || data.total,
          createdAt: data.createdAt, updatedAt: data.updatedAt, notes: data.notes,
          customerName: merged.name || data.customerName || cust.name || "",
          customerPhone: merged.phone,
          customer: { name: merged.name || cust.name || "", phone: merged.phone, address: cust.address },
          deliveryInfo: merged, items: data.items || [], feedback: data.feedback,
        };
      });
      // ── Detect new and newly-cancelled orders for alerting ──────────────
      // Skip the very first snapshot after login/reload entirely — otherwise
      // every pre-existing pending/cancelled order would re-trigger an alert
      // just from opening the dashboard, which is not what "new" means here.
      if (firstSnapshotRef.current) {
        firstSnapshotRef.current = false;
        next.forEach(o => knownStatusRef.current.set(o.orderId, normStatus(o.status)));
      } else {
        const newAlerts: PendingAlert[] = [];
        next.forEach(o => {
          const prevStatus = knownStatusRef.current.get(o.orderId);
          const curStatus  = normStatus(o.status);
          if (prevStatus === undefined && curStatus === "PENDING") {
            newAlerts.push({ id: `new_${o.orderId}_${Date.now()}`, kind: "NEW", order: o });
          } else if (prevStatus && prevStatus !== "CANCELLED" && curStatus === "CANCELLED") {
            newAlerts.push({ id: `cancel_${o.orderId}_${Date.now()}`, kind: "CANCELLED", order: o });
          }
          knownStatusRef.current.set(o.orderId, curStatus);
        });
        if (newAlerts.length) setAlerts(prev => [...prev, ...newAlerts]);
      }

      setOrders(next); setLoading(false); setError("");
    }, err => { setLoading(false); setError(err.message || "Failed to load orders."); });
    return () => unsub();
  }, [user]);

  const role        = getRoleFromEmail(user?.email);
  const customers   = useMemo(() => groupCustomers(orders), [orders]);
  const liveCount   = orders.filter(o => isLive(o.status)).length;
  const pickupCount = orders.filter(o => isLive(o.status) && isPickupOrder(o)).length;

  // Loop the alert tone every 4s while any unacknowledged alert is active;
  // stop immediately once the list is empty. Also play once right away
  // when the first alert of a batch appears.
  useEffect(() => {
    if (alerts.length > 0) {
      playAlertTone();
      toneIntervalRef.current = setInterval(playAlertTone, 4000);
    }
    return () => {
      if (toneIntervalRef.current) { clearInterval(toneIntervalRef.current); toneIntervalRef.current = null; }
    };
  }, [alerts.length > 0]);

  const acknowledgeAlert = useCallback((id: string) => {
    setAlerts(prev => prev.filter(a => a.id !== id));
  }, []);

  const handleOrderClick = useCallback((o: OnlineOrder) => setSelectedOrder(o), []);

  async function handleLogin(email: string, password: string) {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    if (!getRoleFromEmail(cred.user.email)) { await signOut(auth); throw new Error("No dashboard access for this account."); }
  }

  if (authLoading) {
    return (
      <div style={{ background:C.bg }} className="flex min-h-screen items-center justify-center">
        <div style={{ color:C.muted }} className="text-sm">Checking login…</div>
      </div>
    );
  }
  if (!user) return <LoginScreen onLogin={handleLogin} />;

  const activeNav = NAV_ITEMS.find(n => n.id === tab);

  return (
    <div style={{ background:C.bg }} className="min-h-screen">
      <AlertBanner alerts={alerts} onAcknowledge={acknowledgeAlert}
        onOpenOrder={(o) => setSelectedOrder(o)} />

      {selectedOrder && (
        <OrderDetailModal order={selectedOrder} onClose={() => setSelectedOrder(null)}
          busyOrderId={busy} setBusyOrderId={setBusy} />
      )}

      <div className="flex min-h-screen">
        <Sidebar tab={tab} setTab={setTab} open={menuOpen} setOpen={setMenuOpen}
          role={role} liveCount={liveCount} pickupCount={pickupCount} />

        <main className="flex-1 p-4 sm:p-6 lg:p-8 min-w-0" style={alerts.length ? { paddingTop: 76 } : undefined}>
          <div className="mx-auto max-w-7xl">
            <TopBar title={activeNav?.label||tab} icon={activeNav?.icon||""} setMenuOpen={setMenuOpen}
              user={user} role={role} onSignOut={() => signOut(auth)} liveCount={liveCount} />

            {loading && (
              <Card className="p-10 text-center">
                <span style={{ color:C.muted }}>Loading orders from Firestore…</span>
              </Card>
            )}
            {!loading && error && (
              <div style={{ background:"#200808", border:`1px solid ${C.red}44`, color:"#FCA5A5" }}
                className="rounded-2xl p-6 text-sm font-semibold mb-6">{error}</div>
            )}
            {!loading && (
              <>
                {tab==="dashboard" && <DashboardView orders={orders} customers={customers} goToLive={()=>setTab("live")} onOrderClick={handleOrderClick} />}
                {tab==="live"      && <LiveOrdersView orders={orders} busyOrderId={busy} setBusyOrderId={setBusy} onOrderClick={handleOrderClick} />}
                {tab==="pickup"    && <PickupQueueView orders={orders} busyOrderId={busy} setBusyOrderId={setBusy} onOrderClick={handleOrderClick} />}
                {tab==="cancelled" && <CancelledOrdersView orders={orders} onOrderClick={handleOrderClick} />}
                {tab==="history"   && <HistoryView orders={orders} onOrderClick={handleOrderClick} />}
                {tab==="customers" && <CustomersView customers={customers} onOrderClick={handleOrderClick} />}
                {tab==="feedback"  && <FeedbackRatingsView orders={orders} onOrderClick={handleOrderClick} />}
                {tab==="complaints"&& <ComplaintsView orders={orders} onOrderClick={handleOrderClick} />}
                {tab==="promotions"&& <PromotionsView />}
                {tab==="reports"   && <ReportsView orders={orders} />}
                {tab==="menu"      && <MenuManagerView />}
                {tab==="settings"  && <SettingsView role={role} />}
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}