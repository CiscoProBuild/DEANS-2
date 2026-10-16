<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('admin_users')) {
            Schema::create('admin_users', function (Blueprint $table) {
                $table->increments('id');
                $table->string('username', 191)->unique();
                $table->string('password');
                $table->string('created_at', 32);
                $table->string('updated_at', 32);
            });
        }

        if (! Schema::hasTable('students')) {
            Schema::create('students', function (Blueprint $table) {
                $table->increments('id');
                $table->string('student_name');
                $table->string('academic_year', 64)->default('');
                $table->string('semester', 64)->default('');
                $table->string('program', 191)->default('');
                $table->string('year_level', 64)->default('');
                $table->string('section', 64)->default('');
                $table->text('remarks');
                $table->string('created_at', 32);
                $table->string('updated_at', 32);
                $table->index(['academic_year', 'semester', 'program', 'year_level', 'section'], 'idx_students_filters');
            });
        }

        if (! Schema::hasTable('subjects')) {
            Schema::create('subjects', function (Blueprint $table) {
                $table->increments('id');
                $table->unsignedInteger('student_id');
                $table->string('subject_code', 191)->default('');
                $table->text('subject_description');
                $table->double('units')->default(0);
                $table->double('grade')->nullable();
                $table->text('remarks');
                $table->index('student_id', 'idx_subjects_student');
                $table->foreign('student_id')->references('id')->on('students')->cascadeOnDelete();
            });
        }

        if (! Schema::hasTable('cached_results')) {
            Schema::create('cached_results', function (Blueprint $table) {
                $table->char('id', 32)->primary();
                $table->longText('payload');
                $table->string('created_at', 32);
            });
        }

        if (DB::table('admin_users')->count() === 0) {
            $stamp = now()->toISOString();
            DB::table('admin_users')->insert([
                'username' => 'admin',
                'password' => Hash::make(env('INITIAL_ADMIN_PASSWORD', 'admin')),
                'created_at' => $stamp,
                'updated_at' => $stamp,
            ]);
        }
    }

    public function down(): void
    {
        // Existing academic records may predate this migration; never drop them on rollback.
    }
};
