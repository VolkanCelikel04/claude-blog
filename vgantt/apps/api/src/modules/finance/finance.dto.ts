import {
  IsDateString, IsEnum, IsInt, IsNumber, IsOptional, IsString, IsUUID,
  Max, MaxLength, Min, MinLength, IsBoolean, IsEmail,
} from 'class-validator';

export const EXPENSE_PERIODS = ['weekly', 'monthly', 'quarterly', 'yearly'] as const;
export const PAYMENT_METHODS = ['bank_transfer', 'credit_card', 'cash', 'cheque', 'other'] as const;

export class CreateRecurringExpenseDto {
  @IsString() @MinLength(2) @MaxLength(200)
  title!: string;

  @IsOptional() @IsUUID()
  categoryId?: string;

  @IsOptional() @IsString() @MaxLength(200)
  vendor?: string;

  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01)
  amount!: number;

  @IsOptional() @IsString() @MaxLength(3)
  currency?: string;

  @IsEnum(EXPENSE_PERIODS)
  period!: (typeof EXPENSE_PERIODS)[number];

  @IsOptional() @IsInt() @Min(1) @Max(31)
  dayOfMonth?: number;

  @IsOptional() @IsDateString()
  startDate?: string;

  @IsOptional() @IsDateString()
  endDate?: string;

  @IsOptional() @IsString() @MaxLength(100)
  paymentMethod?: string;

  @IsOptional() @IsString() @MaxLength(1000)
  notes?: string;
}

export class PayOccurrenceDto {
  @IsOptional() @IsDateString()
  paidOn?: string;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  paidAmount?: number;

  @IsOptional() @IsString() @MaxLength(120)
  reference?: string;
}

export class CreateCustomerDto {
  @IsString() @MinLength(2) @MaxLength(200)
  name!: string;

  @IsOptional() @IsEmail()
  email?: string;

  @IsOptional() @IsString() @MaxLength(40)
  phone?: string;

  @IsOptional() @IsString() @MaxLength(100)
  taxOffice?: string;

  @IsOptional() @IsString() @MaxLength(40)
  taxNumber?: string;

  @IsOptional() @IsString() @MaxLength(500)
  address?: string;
}

export class CreateInvoiceDto {
  @IsUUID()
  customerId!: string;

  @IsString() @MinLength(1) @MaxLength(60)
  invoiceNo!: string;

  @IsOptional() @IsString() @MaxLength(500)
  description?: string;

  @IsOptional() @IsDateString()
  issueDate?: string;

  /** Vade tarihi - the 3-day reminder counts back from here. */
  @IsDateString({}, { message: 'Vade tarihi zorunludur.' })
  dueDate!: string;

  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01)
  amount!: number;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100)
  taxRate?: number;

  @IsOptional() @IsString() @MaxLength(3)
  currency?: string;
}

export class RecordPaymentDto {
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01)
  amount!: number;

  @IsOptional() @IsDateString()
  paidOn?: string;

  @IsOptional() @IsEnum(PAYMENT_METHODS)
  method?: (typeof PAYMENT_METHODS)[number];

  @IsOptional() @IsString() @MaxLength(120)
  reference?: string;

  @IsOptional() @IsString() @MaxLength(500)
  notes?: string;
}

export class ReceivableQueryDto {
  @IsOptional() @IsString()
  riskBucket?: 'overdue' | 'due_today' | 'due_soon' | 'upcoming' | 'scheduled' | 'paid';

  @IsOptional() @IsUUID()
  customerId?: string;

  @IsOptional() @IsBoolean()
  onlyOpen?: boolean;

  @IsOptional() @IsInt() @Min(1) @Max(200)
  limit?: number;

  @IsOptional() @IsInt() @Min(0)
  offset?: number;
}
