// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  FamilyAccountCreateSchema,
  FamilyAccountUpdateSchema,
  FamilyCreateSchema,
  FamilyGoalCreateSchema,
  FamilyGoalDepositSchema,
  FamilyGoalUpdateSchema,
  FamilyInviteCreateSchema,
  FamilyJoinSchema,
  FamilyTransactionCreateSchema,
  type FamilyAccountCreateInput,
  type FamilyAccountUpdateInput,
  type FamilyCreateInput,
  type FamilyGoalCreateInput,
  type FamilyGoalDepositInput,
  type FamilyGoalUpdateInput,
  type FamilyInviteCreateInput,
  type FamilyJoinInput,
  type FamilyTransactionCreateInput,
} from '@puls/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { SessionGuard } from '../auth/session.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { FamilyService } from './family.service';

/**
 * Семейный режим (ТЗ §4): семья, приглашения, общие счета и цели. Все
 * эндпоинты под SessionGuard и работают только в своей семье; личный дневник
 * (чек-ины, личные финансы, цели) семье недоступен — его отдают свои модули.
 */
@Controller('family')
@UseGuards(SessionGuard)
export class FamilyController {
  constructor(private readonly family: FamilyService) {}

  @Get()
  async get(@Req() req: AuthenticatedRequest) {
    return { family: await this.family.getFamily(req.user!.id) };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body(new ZodValidationPipe(FamilyCreateSchema)) body: FamilyCreateInput,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.family.create(req.user!.id, body);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Req() req: AuthenticatedRequest): Promise<void> {
    await this.family.deleteFamily(req.user!.id);
  }

  @Post('invites')
  @HttpCode(HttpStatus.CREATED)
  invite(
    @Body(new ZodValidationPipe(FamilyInviteCreateSchema)) body: FamilyInviteCreateInput,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.family.createInvite(req.user!.id, body);
  }

  @Post('join')
  @HttpCode(HttpStatus.OK)
  join(
    @Body(new ZodValidationPipe(FamilyJoinSchema)) body: FamilyJoinInput,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.family.join(req.user!.id, body);
  }

  @Delete('members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeMember(
    @Param('userId') userId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.family.removeMember(req.user!.id, userId);
  }

  @Post('leave')
  @HttpCode(HttpStatus.NO_CONTENT)
  async leave(@Req() req: AuthenticatedRequest): Promise<void> {
    await this.family.leave(req.user!.id);
  }

  @Get('accounts')
  accounts(@Req() req: AuthenticatedRequest) {
    return this.family.listAccounts(req.user!.id);
  }

  @Post('accounts')
  @HttpCode(HttpStatus.CREATED)
  createAccount(
    @Body(new ZodValidationPipe(FamilyAccountCreateSchema)) body: FamilyAccountCreateInput,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.family.createAccount(req.user!.id, body);
  }

  @Put('accounts/:id')
  updateAccount(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(FamilyAccountUpdateSchema)) body: FamilyAccountUpdateInput,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.family.updateAccount(req.user!.id, id, body);
  }

  @Delete('accounts/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeAccount(@Param('id') id: string, @Req() req: AuthenticatedRequest): Promise<void> {
    await this.family.removeAccount(req.user!.id, id);
  }

  @Get('accounts/:id/transactions')
  async transactions(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return { transactions: await this.family.listTransactions(req.user!.id, id) };
  }

  @Post('accounts/:id/transactions')
  @HttpCode(HttpStatus.CREATED)
  createTransaction(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(FamilyTransactionCreateSchema)) body: FamilyTransactionCreateInput,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.family.createTransaction(req.user!.id, id, body);
  }

  @Get('goals')
  async goals(@Req() req: AuthenticatedRequest) {
    return { goals: await this.family.listGoals(req.user!.id) };
  }

  @Post('goals')
  @HttpCode(HttpStatus.CREATED)
  createGoal(
    @Body(new ZodValidationPipe(FamilyGoalCreateSchema)) body: FamilyGoalCreateInput,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.family.createGoal(req.user!.id, body);
  }

  @Put('goals/:id')
  updateGoal(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(FamilyGoalUpdateSchema)) body: FamilyGoalUpdateInput,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.family.updateGoal(req.user!.id, id, body);
  }

  @Delete('goals/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeGoal(@Param('id') id: string, @Req() req: AuthenticatedRequest): Promise<void> {
    await this.family.removeGoal(req.user!.id, id);
  }

  @Post('goals/:id/deposit')
  @HttpCode(HttpStatus.CREATED)
  depositGoal(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(FamilyGoalDepositSchema)) body: FamilyGoalDepositInput,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.family.depositGoal(req.user!.id, id, body);
  }
}
