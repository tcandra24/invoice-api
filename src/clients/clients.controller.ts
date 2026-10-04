import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ClientsService } from './clients.service';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';

@ApiTags('clients')
@ApiBearerAuth()
@Controller('clients')
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @Post()
  @ApiOperation({ summary: 'Tambah client' })
  create(@CurrentUser('id') userId: string, @Body() dto: CreateClientDto) {
    return this.clientsService.create(userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Daftar client milik user' })
  findAll(@CurrentUser('id') userId: string) {
    return this.clientsService.findAll(userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detail client' })
  findOne(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.clientsService.findOne(userId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Ubah data client' })
  update(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateClientDto,
  ) {
    return this.clientsService.update(userId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Hapus client (gagal jika masih punya invoice)' })
  remove(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.clientsService.remove(userId, id);
  }
}
