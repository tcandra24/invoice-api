export class CreateClientDto {
  // Sementara dikirim lewat body. Di hari 4 diganti dari JWT (user yang login).
  userId: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
}
