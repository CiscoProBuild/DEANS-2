# Dean's List System (Laravel + React)

The application now runs on Laravel 13 with the existing React interface built
by Vite. The Laravel project is located in `C:\xampp\htdocs\deans-lister-system`
and uses the existing XAMPP MariaDB database (`dean_lister`), preserving its
student and subject records.

## Requirements

- PHP 8.3 or newer with `pdo_mysql`, `mbstring`, `zip`, `xml`, and the GD extension
- Composer
- Node.js 20.19 or newer and npm
- XAMPP MariaDB running on port 3306

The current XAMPP Apache installation uses PHP 8.0, which is too old for
Laravel 13. To avoid changing Apache's PHP runtime for other local sites, this
project's dev command uses the installed PHP 8.3 CLI. The project remains under
`htdocs`; open the app at <http://127.0.0.1:8000> while the dev command runs.

## First-time setup

From PowerShell:

```powershell
cd C:\xampp\htdocs\deans-lister-system
Copy-Item .env.example .env
```

Configure the local MySQL credentials in `.env`, then run:

```powershell
composer install --ignore-platform-req=ext-gd
php artisan key:generate
php artisan migrate --force
npm install
npm run build
```

The migration adds Laravel's migration tracking and only creates system tables
that do not already exist. Existing `students`, `subjects`, `admin_users`, and
`cached_results` rows are left in place. Laravel sessions are stored as files,
so the pre-existing MariaDB `sessions` table is not modified.

The default administrator is `admin` / `admin` only when no administrator
exists yet. Change that password after the first sign-in. Existing plaintext
administrator passwords continue to work for the first login and are
automatically upgraded to Laravel hashes; passwords are never returned by the
account API.

## Run locally

```powershell
npm run dev
```

This starts Laravel at <http://127.0.0.1:8000> and Vite for React hot reload.
To build the React frontend for a production-like run, use `npm run build`, then
start Laravel with:

```powershell
php -d extension=gd artisan serve --host=127.0.0.1 --port=8000
```

Run PHPUnit with GD enabled because PhpSpreadsheet declares GD for optional
workbook-image support:

```powershell
php -d extension=gd artisan test
```

## Features

- Student verification portal and administrator login/session
- Student and subject CRUD, search, dashboard summaries, password changes
- Excel imports for registrar workbooks and generic grade spreadsheets
- Student academic-record Excel/PDF exports and downloadable templates
- Dean's List screening upload and cached Excel/PDF exports

Uploads are limited to 16 MB. Keep `.env` private and do not put database
credentials or student backups in a public repository.
