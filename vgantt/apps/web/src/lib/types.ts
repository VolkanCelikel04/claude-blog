export interface TenantSession {
  userId: string;
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  email: string;
  fullName: string;
  permissions: string[];
  enabledModules: string[];
  roles: string[];
  subscription: { status: string; endsOn: string | null; daysRemaining: number | null } | null;
}

export interface AdminSession {
  adminUserId: string;
  email: string;
  fullName: string;
  role: string;
}

export interface Notification {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  category: string;
  module_key: string | null;
  title: string;
  body: string | null;
  threshold_days: number | null;
  due_date: string | null;
  action_url: string | null;
  is_read: boolean;
  created_at: string;
}

export interface LicenseRow {
  id: string;
  name: string;
  license_type: string;
  vendor: string | null;
  end_date: string;
  cost: string | null;
  currency: string;
  auto_renew: boolean;
  status: string;
  days_remaining: number;
  expiry_bucket: 'expired' | 'critical' | 'urgent' | 'warning' | 'upcoming' | 'ok' | 'inactive';
  owner_name: string | null;
}

export interface ReceivableRow {
  id: string;
  invoice_no: string;
  customer_name: string;
  issue_date: string;
  due_date: string;
  total: string;
  paid_amount: string;
  outstanding: string;
  currency: string;
  status: string;
  days_to_due: number;
  days_overdue: number;
  risk_bucket: 'overdue' | 'due_today' | 'due_soon' | 'upcoming' | 'scheduled' | 'paid' | 'cancelled';
}

export interface FinanceOverview {
  monthly: Array<{
    month: string;
    invoiced: number;
    collected: number;
    expensePaid: number;
    expenseOpen: number;
    netCash: number;
  }>;
  aging: Array<{ bucket: string; invoiceCount: number; outstanding: number }>;
  totals: {
    openReceivables: number;
    overdueReceivables: number;
    dueWithin3Days: number;
    monthlyExpenseTotal: number;
    unpaidExpenseTotal: number;
  };
  topDebtors: Array<{ customerName: string; outstanding: number; overdueCount: number }>;
}

export interface ModuleMatrixRow {
  tenant_id: string;
  tenant_name: string;
  module_key: string;
  module_name: string;
  is_core: boolean;
  requires_desktop: boolean;
  is_enabled: boolean;
  valid_until: string | null;
  module_days_remaining: number | null;
}

export interface TenantOverviewRow {
  tenant_id: string;
  slug: string;
  name: string;
  tenant_status: string;
  subscription_status: string | null;
  plan_name: string | null;
  ends_on: string | null;
  days_remaining: number | null;
  expiry_bucket: 'expired' | 'critical' | 'urgent' | 'warning' | 'upcoming' | 'ok' | 'none';
  active_users: number;
  enabled_modules: number;
  open_balance: string;
  overdue_balance: string;
}
