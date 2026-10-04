import { config } from 'dotenv';
import { resolve } from 'path';

// Dijalankan sebelum file test. Nilai dari .env.test menang atas .env,
// karena ConfigModule tidak menimpa variabel yang sudah ada.
config({ path: resolve(__dirname, '../.env.test'), override: true });
