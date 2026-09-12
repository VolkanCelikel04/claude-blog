import { Module } from '@nestjs/common';
import { FinanceController } from './finance.controller';
import { ExpensesService } from './expenses.service';
import { ReceivablesService } from './receivables.service';
import { FinanceDashboardService } from './finance-dashboard.service';

@Module({
  controllers: [FinanceController],
  providers: [ExpensesService, ReceivablesService, FinanceDashboardService],
  exports: [FinanceDashboardService],
})
export class FinanceModule {}
