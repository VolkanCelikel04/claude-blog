import {
  Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ExpensesService } from './expenses.service';
import { ReceivablesService } from './receivables.service';
import { FinanceDashboardService } from './finance-dashboard.service';
import {
  CreateCustomerDto, CreateInvoiceDto, CreateRecurringExpenseDto,
  PayOccurrenceDto, ReceivableQueryDto, RecordPaymentDto,
} from './finance.dto';
import { RequiresModule } from '../../common/licensing/requires-module.decorator';
import { RequirePermissions } from '../../common/rbac/permissions.decorator';
import { RequireAudience } from '../../common/auth/decorators';

/**
 * MODULE B - Finans ve Ödeme Takibi
 */
@ApiTags('finance')
@Controller('finance')
@RequireAudience('tenant')
@RequiresModule('finance')
export class FinanceController {
  constructor(
    private readonly expenses: ExpensesService,
    private readonly receivables: ReceivablesService,
    private readonly dashboard: FinanceDashboardService,
  ) {}

  // ------------------------------------------------------------- dashboard
  @Get('dashboard')
  @RequirePermissions('finance.read')
  @ApiOperation({ summary: 'Grafikler için aylık özet, yaşlandırma ve toplamlar' })
  overview() {
    return this.dashboard.overview();
  }

  // ------------------------------------------- aylık düzenli giderler
  @Get('expenses')
  @RequirePermissions('finance.read')
  listExpenses() {
    return this.expenses.list();
  }

  @Get('expenses/upcoming')
  @RequirePermissions('finance.read')
  @ApiOperation({ summary: 'Vadesi yaklaşan ve geciken gider taksitleri' })
  upcomingExpenses(@Query('withinDays') withinDays?: string) {
    return this.expenses.upcoming(withinDays ? Number(withinDays) : 45);
  }

  @Post('expenses')
  @RequirePermissions('finance.expense.write')
  createExpense(@Body() dto: CreateRecurringExpenseDto) {
    return this.expenses.create(dto);
  }

  @Post('expenses/occurrences/:id/pay')
  @RequirePermissions('finance.payment.write')
  payOccurrence(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PayOccurrenceDto) {
    return this.expenses.markPaid(id, dto);
  }

  @Delete('expenses/:id')
  @RequirePermissions('finance.delete')
  removeExpense(@Param('id', ParseUUIDPipe) id: string) {
    return this.expenses.remove(id);
  }

  @Get('categories')
  @RequirePermissions('finance.read')
  categories() {
    return this.expenses.categories();
  }

  // --------------------------------------------- müşteri ödeme takibi
  @Get('invoices')
  @RequirePermissions('finance.read')
  @ApiOperation({ summary: 'Alacaklar; risk_bucket=overdue olanlar arayüzde kırmızı gösterilir' })
  listInvoices(@Query() query: ReceivableQueryDto) {
    return this.receivables.list(query);
  }

  @Get('invoices/:id')
  @RequirePermissions('finance.read')
  invoice(@Param('id', ParseUUIDPipe) id: string) {
    return this.receivables.findOne(id);
  }

  @Post('invoices')
  @RequirePermissions('finance.invoice.write')
  createInvoice(@Body() dto: CreateInvoiceDto) {
    return this.receivables.createInvoice(dto);
  }

  @Post('invoices/:id/payments')
  @RequirePermissions('finance.payment.write')
  @ApiOperation({ summary: 'Tahsilat kaydı; fatura durumu trigger ile yeniden hesaplanır' })
  recordPayment(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RecordPaymentDto) {
    return this.receivables.recordPayment(id, dto);
  }

  @Post('invoices/:id/cancel')
  @RequirePermissions('finance.invoice.write')
  cancelInvoice(@Param('id', ParseUUIDPipe) id: string, @Body('reason') reason?: string) {
    return this.receivables.cancelInvoice(id, reason);
  }

  // ---------------------------------------------------------- müşteriler
  @Get('customers')
  @RequirePermissions('finance.read')
  listCustomers() {
    return this.receivables.listCustomers();
  }

  @Post('customers')
  @RequirePermissions('finance.invoice.write')
  createCustomer(@Body() dto: CreateCustomerDto) {
    return this.receivables.createCustomer(dto);
  }
}
