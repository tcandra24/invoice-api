import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ClientsService } from './clients.service';
import { CreateClientDto } from './dto/create-client.dto';
import { QueryClientsDto } from './dto/query-clients.dto';
import { UpdateClientDto } from './dto/update-client.dto';

@ApiTags('clients')
@ApiBearerAuth()
@Controller('clients')
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @Post()
  @ApiOperation({ summary: 'Add client' })
  create(@CurrentUser('id') userId: string, @Body() dto: CreateClientDto) {
    return this.clientsService.create(userId, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'List clients owned by user (pagination + search by name/email)',
  })
  findAll(
    @CurrentUser('id') userId: string,
    @Query() query: QueryClientsDto,
  ) {
    return this.clientsService.findAll(userId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detail client' })
  findOne(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.clientsService.findOne(userId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update client data' })
  update(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateClientDto,
  ) {
    return this.clientsService.update(userId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete client (fails if has invoices)' })
  remove(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.clientsService.remove(userId, id);
  }
}
