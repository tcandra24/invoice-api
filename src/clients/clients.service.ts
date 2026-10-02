import { Injectable } from '@nestjs/common';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { Client } from './entities/client.entity';

@Injectable()
export class ClientsService {
  private clients: Client[] = [];
  private nextId = 1;

  create(createClientDto: CreateClientDto): Client {
    const client: Client = {
      id: this.nextId++,
      ...createClientDto,
      createdAt: new Date(),
    };

    this.clients.push(client);

    return client;
  }

  findAll(): Client[] {
    return this.clients;
  }

  findOne(id: number): Client {
    const client = this.clients.find((c) => c.id === id);
    if (!client) {
      throw new Error(`Client with id ${id} not found`);
    }

    return client;
  }

  update(id: number, updateClientDto: UpdateClientDto): Client {
    const client = this.findOne(id);
    Object.assign(client, updateClientDto);
    return client;
  }

  remove(id: number): { message: string } {
    const client = this.findOne(id);
    this.clients = this.clients.filter((c) => c.id !== client.id);
    return { message: `Client ${id} berhasil dihapus` };
  }
}
