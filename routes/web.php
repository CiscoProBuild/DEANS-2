<?php

use App\Http\Controllers\AdminController;
use App\Http\Controllers\ImportExportController;
use App\Http\Controllers\StudentController;
use Illuminate\Support\Facades\Route;

Route::view('/', 'app');
Route::view('/portal', 'app');
Route::view('/login', 'app');
Route::view('/admin', 'app')->middleware('admin');

Route::post('/login', [AdminController::class, 'login']);
Route::post('/logout', [AdminController::class, 'logout']);

Route::get('/api/session', [AdminController::class, 'session']);
Route::get('/api/verify', [StudentController::class, 'verify']);
Route::post('/upload', [ImportExportController::class, 'uploadForScreening']);
Route::get('/export/excel/{resultId}', [ImportExportController::class, 'exportScreeningExcel']);
Route::get('/export/pdf/{resultId}', [ImportExportController::class, 'exportScreeningPdf']);
Route::get('/download-template', [ImportExportController::class, 'genericTemplate']);
Route::get('/download-academic-template', [ImportExportController::class, 'academicTemplate']);

Route::middleware('admin')->prefix('api')->group(function () {
    Route::get('/admin/account', [AdminController::class, 'account']);
    Route::post('/admin/change-password', [AdminController::class, 'changePassword']);

    Route::get('/students', [StudentController::class, 'index']);
    Route::post('/students', [StudentController::class, 'store']);
    Route::delete('/students', [StudentController::class, 'destroyAll']);
    Route::get('/students/{studentId}', [StudentController::class, 'show'])->whereNumber('studentId');
    Route::put('/students/{studentId}', [StudentController::class, 'update'])->whereNumber('studentId');
    Route::patch('/students/{studentId}', [StudentController::class, 'update'])->whereNumber('studentId');
    Route::delete('/students/{studentId}', [StudentController::class, 'destroy'])->whereNumber('studentId');

    Route::get('/subjects', [StudentController::class, 'subjects']);
    Route::post('/subjects', [StudentController::class, 'storeSubject']);
    Route::match(['put', 'patch'], '/subjects/{subjectId}', [StudentController::class, 'updateSubject'])->whereNumber('subjectId');
    Route::delete('/subjects/{subjectId}', [StudentController::class, 'destroySubject'])->whereNumber('subjectId');

    Route::get('/options', [StudentController::class, 'options']);
    Route::get('/dashboard', [StudentController::class, 'dashboard']);
    Route::post('/import', [ImportExportController::class, 'import']);
    Route::get('/export/excel', [ImportExportController::class, 'exportAcademicExcel']);
    Route::get('/export/pdf', [ImportExportController::class, 'exportAcademicPdf']);
});
