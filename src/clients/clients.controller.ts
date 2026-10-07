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
import { MessageResponseDto } from '../common/dto/message-response.dto';
import {
  ApiErrorResponses,
  ApiPaginatedResponse,
  ApiWrappedResponse,
} from '../common/swagger/api-responses';
import { ClientsService } from './clients.service';
import { ClientResponseDto } from './dto/client-response.dto';
import { CreateClientDto } from './dto/create-client.dto';
import { QueryClientsDto } from './dto/query-clients.dto';
import { UpdateClientDto } from './dto/update-client.dto';

@ApiTags('clients')
@ApiBearerAuth()
@ApiErrorResponses(400, 401, 429)
@Controller('clients')
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @Post()
  @ApiOperation({ summary: 'Add client' })
  @ApiWrappedResponse(ClientResponseDto, { status: 201 })
  create(@CurrentUser('id') userId: string, @Body() dto: CreateClientDto) {
    return this.clientsService.create(userId, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'List clients owned by user (pagination + search by name/email)',
  })
  @ApiPaginatedResponse(ClientResponseDto)
  findAll(@CurrentUser('id') userId: string, @Query() query: QueryClientsDto) {
    return this.clientsService.findAll(userId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detail client' })
  @ApiWrappedResponse(ClientResponseDto)
  @ApiErrorResponses(404)
  findOne(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.clientsService.findOne(userId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update client data' })
  @ApiWrappedResponse(ClientResponseDto)
  @ApiErrorResponses(404)
  update(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateClientDto,
  ) {
    return this.clientsService.update(userId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete client (fails if has invoices)' })
  @ApiWrappedResponse(MessageResponseDto)
  @ApiErrorResponses(404, 409)
  remove(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.clientsService.remove(userId, id);
  }
}
