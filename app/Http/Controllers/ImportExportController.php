<?php

namespace App\Http\Controllers;

use App\Services\StudentRecords;
use Barryvdh\DomPDF\Facade\Pdf;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use PhpOffice\PhpSpreadsheet\Cell\Coordinate;
use PhpOffice\PhpSpreadsheet\IOFactory;
use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx;
use Throwable;

class ImportExportController extends Controller
{
    private const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    public function import(Request $request): JsonResponse
    {
        $request->validate([
            'file' => ['required', 'file', 'max:16384', 'mimes:xlsx,xls'],
        ]);

        try {
            $file = $request->file('file');
            $records = $this->parseRegistrarWorkbook($file->getRealPath());
            if (! count($records)) {
                $records = $this->parseGenericWorkbook($file->getRealPath(), $request->all());
            }
            $result = $this->importStudentRecords($records);

            return response()->json([
                'message' => "Imported {$result['created']} new students and updated {$result['updated']} existing students.",
                ...$result,
            ]);
        } catch (Throwable $error) {
            report($error);
            $status = str_starts_with($error->getMessage(), 'Missing required columns')
                || str_contains($error->getMessage(), 'contains no data') ? 422 : 500;

            return response()->json(['error' => $error->getMessage()], $status);
        }
    }

    public function academicTemplate()
    {
        $sheet = (new Spreadsheet)->getActiveSheet();
        $sheet->fromArray([
            [], [], [], [], [], [], [], [], [], [],
            ['ACCUMULATED FINAL GRADES'],
            ['2nd Term, A.Y. 2025-2026'],
            [], [], ['PROGRAM: BS in Information Technology', '', '', '', 'YEAR: First Year', '', '', '', '', 'SECTION: F1'],
            [], [], [], [],
            ['', 'STUDENT NAME (Last Name, First Name Middle Name)', 'ITC 121', 'PE 121', 'ITE 121', 'ENG 111', 'FIL 112', 'ITP 121', 'ITP 122', 'NSTP 2', 'SOC SCI 112', 'Total', 'General Weighted Average', 'Remarks'],
            ['', '', 'Computer Programming 2', 'Fundamentals of Rhythmic Activities', 'Electronics with Technical Drawing', 'Purposive Communication', "Filipino sa iba't ibang Disiplina", 'Discrete Mathematics', 'Introduction to HCI 1', 'National Service Training Program 2', 'Gender and Society'],
            ['', '', 3, 3, 3, 3, 3, 3, 3, 3, 3],
            [],
            ['', 'SAMPLE STUDENT, JUAN'],
        ]);
        $sheet->setTitle('BSIT 1-F1');

        return $this->downloadWorkbook((new Spreadsheet), 'Mindoro_State_University_Academic_Record_Template.xlsx');
    }

    public function genericTemplate()
    {
        $spreadsheet = new Spreadsheet;
        $spreadsheet->getActiveSheet()->fromArray([
            ['Student ID', 'Last Name', 'First Name', 'Course', 'Year Level', 'Subject Code', 'Units', 'Final Grade'],
            ['2023-001', 'Dela Cruz', 'Juan', 'BSIT', '1st Year', 'CC101', 3, 1.25],
        ]);
        $spreadsheet->getActiveSheet()->setTitle("Dean's List Data");

        return $this->downloadWorkbook($spreadsheet, 'Deans_Lister_Template.xlsx');
    }

    public function exportAcademicExcel(Request $request)
    {
        $records = app(StudentRecords::class)->filtered($request->query());
        $spreadsheet = new Spreadsheet;
        $firstSheetAvailable = true;
        $groups = [];
        foreach ($records as $record) {
            $group = ($record['academic_year'] ?: 'Unspecified Year').' - '.($record['section'] ?: 'Unspecified Section');
            $semester = $record['semester'] ?: 'Unspecified Semester';
            $groups[$group][$semester][] = $record;
        }

        $sheetNames = [];
        foreach ($groups as $group => $terms) {
            $sheetName = mb_substr(str_replace(['[', ']', ':', '*', '?', '/', '\\'], '-', $group) ?: 'Report', 0, 31);
            $base = $sheetName;
            $suffix = 2;
            while (isset($sheetNames[$sheetName])) {
                $sheetName = mb_substr($base, 0, 27).' ('.$suffix++.')';
            }
            $sheetNames[$sheetName] = true;
            $sheet = $firstSheetAvailable ? $spreadsheet->getActiveSheet() : $spreadsheet->createSheet();
            $firstSheetAvailable = false;
            $sheet->setTitle($sheetName);
            $rows = [['ACCUMULATED FINAL GRADES'], [$group]];

            foreach ($terms as $semester => $termRecords) {
                $codes = [];
                foreach ($termRecords as $record) {
                    foreach ($record['subjects'] as $subject) {
                        $codes[$subject['subject_code']] = true;
                    }
                }
                $codes = array_keys($codes);
                $rows[] = [$group.' | '.$semester];
                $rows[] = ['Student Name', ...$codes, 'Total Units', 'General Weighted Average', 'Remarks'];
                usort($termRecords, fn ($left, $right) => strcasecmp($left['student_name'], $right['student_name']));
                foreach ($termRecords as $record) {
                    $grades = [];
                    foreach ($record['subjects'] as $subject) {
                        $grades[$subject['subject_code']] = $subject['grade'];
                    }
                    $rows[] = [
                        $record['student_name'],
                        ...array_map(fn ($code) => $grades[$code] ?? '', $codes),
                        $record['total_units'],
                        $record['gwa'] ?? '',
                        $record['remarks'],
                    ];
                }
                $rows[] = [];
            }
            $sheet->fromArray($rows);
        }

        if (! count($groups)) {
            $sheet = $spreadsheet->getActiveSheet();
            $sheet->setTitle('Records');
            $sheet->setCellValue('A1', 'No student records found.');
        }

        return $this->downloadWorkbook($spreadsheet, 'Student_Academic_Records.xlsx');
    }

    public function exportAcademicPdf(Request $request)
    {
        $records = app(StudentRecords::class)->filtered($request->query());
        $html = '<!doctype html><html><head><meta charset="utf-8"><style>
            body{font-family:DejaVu Sans,sans-serif;font-size:10px;color:#222}
            h1{text-align:center;color:#8a6500;font-size:18px;margin:0}
            .record{page-break-inside:avoid;margin:18px 0;padding-bottom:12px;border-bottom:1px solid #ddd}
            .term{text-align:center;color:#555;margin:4px 0 10px}
            table{width:100%;border-collapse:collapse;margin-top:8px}
            th,td{padding:5px;border:1px solid #ddd;text-align:left}
        </style></head><body>';

        if (! count($records)) {
            $html .= '<p>No student records found.</p>';
        }
        foreach ($records as $record) {
            $html .= '<section class="record"><h1>ACCUMULATED FINAL GRADES</h1><div class="term">'
                .e(($record['academic_year'] ?: 'Unspecified Year').' | '.($record['year_level'] ?: 'Unspecified Year Level').' | '.($record['section'] ?: 'Unspecified Section').' | '.($record['semester'] ?: 'Unspecified Semester'))
                .'</div><strong>'.e($record['student_name']).'</strong> &nbsp; Program: '.e($record['program'])
                .' &nbsp; Units: '.number_format($record['total_units'], 2).' &nbsp; GWA: '
                .($record['gwa'] === null ? 'NO GRADE' : number_format($record['gwa'], 4))
                .'<table><thead><tr><th>Subject</th><th>Description</th><th>Units</th><th>Grade</th></tr></thead><tbody>';
            foreach ($record['subjects'] as $subject) {
                $html .= '<tr><td>'.e($subject['subject_code']).'</td><td>'.e($subject['subject_description']).'</td><td>'
                    .number_format((float) $subject['units'], 2).'</td><td>'
                    .($subject['grade'] === null ? 'NO GRADE' : number_format((float) $subject['grade'], 4)).'</td></tr>';
            }
            $html .= '</tbody></table><p>Remarks: '.e($record['remarks']).'</p></section>';
        }
        $html .= '</body></html>';

        return Pdf::loadHTML($html)->setPaper('a3', 'landscape')->download('Student_Academic_Records.pdf');
    }

    public function uploadForScreening(Request $request): JsonResponse
    {
        $request->validate([
            'file' => ['required', 'file', 'max:16384', 'mimes:xlsx,xls'],
        ]);

        try {
            $records = $this->parseGenericWorkbook($request->file('file')->getRealPath(), []);
            $selected = json_decode((string) $request->input('required_subjects_by_year', '{}'), true);
            $selected = is_array($selected) ? $selected : [];
            $students = array_map(function ($student) {
                $student['full_name'] = $student['student_name'];
                $student['course'] = $student['program'];
                foreach ($student['subjects'] as &$subject) {
                    $subject['final_grade'] = $subject['grade'];
                }
                unset($subject);

                return $student;
            }, $records);
            [$qualifiers, $disqualifiers] = $this->filterDeansList($students, $selected);
            $id = bin2hex(random_bytes(16));
            $meta = [
                'school_name' => StudentRecords::text($request->input('school_name', 'Your School Name')),
                'semester' => StudentRecords::text($request->input('semester')),
                'school_year' => StudentRecords::text($request->input('school_year')),
                'required_subjects_by_year' => $selected,
            ];
            $result = [
                'qualifiers' => $qualifiers,
                'disqualifiers' => $disqualifiers,
                'meta' => $meta,
                'created_at' => now()->toISOString(),
            ];
            DB::table('cached_results')->insert([
                'id' => $id,
                'payload' => json_encode($result, JSON_THROW_ON_ERROR),
                'created_at' => $result['created_at'],
            ]);

            return response()->json([
                'result_id' => $id,
                'total_students' => count($records),
                'total_qualifiers' => count($qualifiers),
                'qualifiers' => $qualifiers,
                'disqualifiers' => $disqualifiers,
                'meta' => $meta,
            ]);
        } catch (Throwable $error) {
            report($error);
            $status = str_starts_with($error->getMessage(), 'Missing required columns')
                || str_contains($error->getMessage(), 'contains no data') ? 422 : 500;

            return response()->json(['error' => $error->getMessage()], $status);
        }
    }

    public function exportScreeningExcel(string $resultId)
    {
        $result = $this->cachedResult($resultId);
        if (! $result) {
            return response('Result not found. Please re-upload the file.', 404);
        }

        $rows = [
            [mb_strtoupper($result['meta']['school_name'])],
            ["DEAN'S LIST OF HONOR"],
            [$result['meta']['semester'].($result['meta']['semester'] ? ' | ' : '').'S.Y. '.$result['meta']['school_year']],
            ['#', 'Student ID', 'Full Name', 'Course / Program', 'Year Level', 'GWA', 'Latin Honor'],
        ];
        $previous = null;
        $rank = 0;
        foreach ($result['qualifiers'] as $student) {
            $group = $student['course'].' - '.$student['year_level'];
            if ($group !== $previous) {
                $previous = $group;
                $rank = 0;
                $rows[] = [$group];
            }
            $rows[] = [
                ++$rank,
                $student['student_id'],
                $student['full_name'],
                $student['course'],
                $student['year_level'],
                $student['gwa'],
                $student['latin_honor'],
            ];
        }
        $rows[] = ['Generated on: '.now()->format('Y-m-d').' | Total Qualifiers: '.count($result['qualifiers'])];

        $spreadsheet = new Spreadsheet;
        $spreadsheet->getActiveSheet()->fromArray($rows);
        $spreadsheet->getActiveSheet()->setTitle("Dean's List");

        return $this->downloadWorkbook($spreadsheet, 'Deans_List.xlsx');
    }

    public function exportScreeningPdf(string $resultId)
    {
        $result = $this->cachedResult($resultId);
        if (! $result) {
            return response('Result not found. Please re-upload the file.', 404);
        }

        $html = '<!doctype html><html><head><meta charset="utf-8"><style>
            body{font-family:DejaVu Sans,sans-serif;font-size:10px;color:#222}
            h1,h2,p{text-align:center}h1{color:#1b3a6b;font-size:20px}
            table{width:100%;border-collapse:collapse;margin-top:20px}
            th,td{padding:7px;border:1px solid #bbb;text-align:left}
        </style></head><body><h1>'.e(mb_strtoupper($result['meta']['school_name']))
            .'</h1><h2>DEAN\\\'S LIST OF HONOR</h2><p>'.e($result['meta']['semester'].' | S.Y. '.$result['meta']['school_year'])
            .'</p><table><thead><tr><th>#</th><th>Student ID</th><th>Full Name</th><th>Course</th><th>Year Level</th><th>GWA</th><th>Latin Honor</th></tr></thead><tbody>';
        foreach ($result['qualifiers'] as $index => $student) {
            $html .= '<tr><td>'.($index + 1).'</td><td>'.e($student['student_id']).'</td><td>'.e($student['full_name'])
                .'</td><td>'.e($student['course']).'</td><td>'.e($student['year_level']).'</td><td>'
                .number_format($student['gwa'], 4).'</td><td>'.e($student['latin_honor']).'</td></tr>';
        }
        $html .= '</tbody></table><p>Generated on: '.now()->format('Y-m-d').' | Total Qualifiers: '.count($result['qualifiers']).'</p></body></html>';

        return Pdf::loadHTML($html)->setPaper('a4', 'landscape')->download('Deans_List.pdf');
    }

    private function parseRegistrarWorkbook(string $path): array
    {
        $workbook = IOFactory::load($path);
        $records = [];

        foreach ($workbook->getAllSheets() as $sheet) {
            if (mb_strtoupper(StudentRecords::text($sheet->getCell('A11')->getValue())) !== 'ACCUMULATED FINAL GRADES') {
                continue;
            }

            $term = StudentRecords::text($sheet->getCell('A12')->getValue());
            $year = '';
            $semester = $term;
            if (preg_match('/^(.+?),\s*A\.Y\.\s*(.+)$/i', $term, $match)) {
                $semester = trim($match[1]);
                $year = trim($match[2]);
            }
            $metadata = [
                'semester' => $semester,
                'academic_year' => $year,
                'program' => preg_replace('/^PROGRAM:\s*/i', '', StudentRecords::text($sheet->getCell('A15')->getValue())),
                'year_level' => preg_replace('/^YEAR:\s*/i', '', StudentRecords::text($sheet->getCell('E15')->getValue())),
                'section' => preg_replace('/^SECTION:\s*/i', '', StudentRecords::text($sheet->getCell('K15')->getValue())),
            ];

            $subjects = [];
            $highestColumn = Coordinate::columnIndexFromString($sheet->getHighestColumn());
            for ($column = 2; $column <= $highestColumn; $column++) {
                $code = StudentRecords::text($sheet->getCell([$column, 20])->getValue());
                if ($code === '' || preg_match('/^student\s*name/i', $code)) {
                    continue;
                }
                if (preg_match('/^(total|general weighted|remarks)/i', $code)) {
                    break;
                }
                $subjects[] = [
                    'subject_code' => $code,
                    'subject_description' => StudentRecords::text($sheet->getCell([$column, 21])->getValue()),
                    'units' => StudentRecords::number($sheet->getCell([$column, 22])->getValue()),
                    'column' => $column,
                ];
            }

            for ($row = 24; $row <= $sheet->getHighestRow(); $row++) {
                $name = StudentRecords::text($sheet->getCell([2, $row])->getValue())
                    ?: StudentRecords::text($sheet->getCell([3, $row])->getValue())
                    ?: StudentRecords::text($sheet->getCell([4, $row])->getValue());
                if ($name === '') {
                    continue;
                }

                $records[] = [
                    'student_name' => $name,
                    ...$metadata,
                    'remarks' => '',
                    'subjects' => array_map(fn ($subject) => [
                        'subject_code' => $subject['subject_code'],
                        'subject_description' => $subject['subject_description'],
                        'units' => $subject['units'],
                        'grade' => StudentRecords::grade($sheet->getCell([$subject['column'], $row])->getValue()),
                        'remarks' => '',
                    ], $subjects),
                ];
            }
        }

        return $records;
    }

    private function parseGenericWorkbook(string $path, array $fields): array
    {
        $workbook = IOFactory::load($path);
        $sheet = $workbook->getSheet(0);
        $rows = $sheet->toArray('', true, true, false);
        if (! count($rows) || ! isset($rows[0])) {
            throw new \RuntimeException('The workbook contains no data rows.');
        }

        $normalizeKey = fn ($key) => str_replace([' ', '/'], '_', mb_strtolower(StudentRecords::text($key)));
        $aliases = [
            'student_id' => ['student_id', 'id', 'studentid', 'student_no', 'student_number'],
            'full_name' => ['full_name', 'fullname', 'name', 'student_name'],
            'last_name' => ['last_name', 'lastname', 'surname'],
            'first_name' => ['first_name', 'firstname', 'given_name'],
            'course' => ['course', 'program', 'course_program', 'dept', 'department'],
            'year_level' => ['year_level', 'year', 'yearlevel', 'level'],
            'subject_code' => ['subject_code', 'subjectcode', 'subject', 'code', 'course_code'],
            'units' => ['units', 'credit_units', 'credit', 'unit'],
            'final_grade' => ['final_grade', 'grade', 'finalgrade', 'final', 'rating'],
        ];
        $columns = [];
        foreach ($aliases as $field => $choices) {
            foreach ($rows[0] as $index => $label) {
                if (in_array($normalizeKey($label), $choices, true)) {
                    $columns[$field] = $index;
                    break;
                }
            }
        }
        $missing = [];
        foreach ($aliases as $field => $_) {
            if (! isset($columns[$field]) && ! in_array($field, ['full_name', 'last_name', 'first_name'], true)) {
                $missing[] = $field;
            }
        }
        if (! isset($columns['full_name']) && (! isset($columns['last_name']) || ! isset($columns['first_name']))) {
            $missing[] = 'full_name (or last_name and first_name)';
        }
        if ($missing) {
            $found = implode(', ', array_map($normalizeKey, $rows[0]));
            throw new \RuntimeException('Missing required columns: '.implode(', ', $missing).". Found columns: $found");
        }

        $students = [];
        foreach (array_slice($rows, 1) as $row) {
            $id = StudentRecords::text($row[$columns['student_id']] ?? '');
            if ($id === '') {
                continue;
            }
            if (! isset($students[$id])) {
                $name = isset($columns['full_name'])
                    ? StudentRecords::text($row[$columns['full_name']] ?? '')
                    : trim(StudentRecords::text($row[$columns['last_name']] ?? '').', '.StudentRecords::text($row[$columns['first_name']] ?? ''), ', ');
                $students[$id] = [
                    'student_id' => $id,
                    'student_name' => $name,
                    'academic_year' => StudentRecords::text($fields['academic_year'] ?? ''),
                    'semester' => StudentRecords::text($fields['semester'] ?? ''),
                    'program' => StudentRecords::text($row[$columns['course']] ?? ''),
                    'year_level' => StudentRecords::text($row[$columns['year_level']] ?? ''),
                    'section' => StudentRecords::text($fields['section'] ?? ''),
                    'remarks' => '',
                    'subjects' => [],
                ];
            }
            $grade = StudentRecords::text($row[$columns['final_grade']] ?? '');
            $students[$id]['subjects'][] = [
                'subject_code' => StudentRecords::text($row[$columns['subject_code']] ?? ''),
                'subject_description' => '',
                'units' => StudentRecords::number($row[$columns['units']] ?? null),
                'grade' => $grade === '' ? null : StudentRecords::grade(str_replace(',', '.', $grade)),
                'remarks' => '',
            ];
        }

        return array_values($students);
    }

    private function importStudentRecords(array $records): array
    {
        $created = 0;
        $updated = 0;
        DB::transaction(function () use ($records, &$created, &$updated) {
            foreach ($records as $record) {
                $candidates = DB::table('students')
                    ->where('student_name', $record['student_name'])
                    ->where('program', $record['program'])
                    ->where('academic_year', $record['academic_year'])
                    ->where('semester', $record['semester'])
                    ->get()
                    ->filter(fn ($candidate) => StudentRecords::normalize($candidate->student_name) === StudentRecords::normalize($record['student_name'])
                        && StudentRecords::normalize($candidate->program) === StudentRecords::normalize($record['program'])
                        && StudentRecords::normalize($candidate->academic_year) === StudentRecords::normalize($record['academic_year'])
                        && StudentRecords::normalize($candidate->semester) === StudentRecords::normalize($record['semester'])
                    )
                    ->values();
                $stamp = now()->toISOString();

                if ($candidates->isNotEmpty()) {
                    $id = (int) $candidates[0]->id;
                    DB::table('students')->where('id', $id)->update([
                        'student_name' => $record['student_name'],
                        'academic_year' => $record['academic_year'],
                        'semester' => $record['semester'],
                        'program' => $record['program'],
                        'year_level' => $record['year_level'],
                        'section' => $record['section'],
                        'updated_at' => $stamp,
                    ]);
                    foreach ($candidates->skip(1) as $duplicate) {
                        DB::table('students')->where('id', $duplicate->id)->delete();
                    }
                    $updated++;
                } else {
                    $id = (int) DB::table('students')->insertGetId([
                        'student_name' => $record['student_name'],
                        'academic_year' => $record['academic_year'],
                        'semester' => $record['semester'],
                        'program' => $record['program'],
                        'year_level' => $record['year_level'],
                        'section' => $record['section'],
                        'remarks' => '',
                        'created_at' => $stamp,
                        'updated_at' => $stamp,
                    ]);
                    $created++;
                }

                DB::table('subjects')->where('student_id', $id)->delete();
                $seen = [];
                foreach ($record['subjects'] as $subject) {
                    $key = json_encode([
                        StudentRecords::normalize($subject['subject_code']),
                        StudentRecords::normalize($subject['subject_description']),
                        $subject['units'],
                        $subject['grade'],
                        StudentRecords::normalize($subject['remarks'] ?? ''),
                    ]);
                    if (isset($seen[$key])) {
                        continue;
                    }
                    $seen[$key] = true;
                    DB::table('subjects')->insert([
                        'student_id' => $id,
                        'subject_code' => $subject['subject_code'],
                        'subject_description' => $subject['subject_description'],
                        'units' => StudentRecords::number($subject['units']),
                        'grade' => StudentRecords::grade($subject['grade']),
                        'remarks' => $subject['remarks'] ?? '',
                    ]);
                }
            }
        });

        return compact('created', 'updated');
    }

    private function filterDeansList(array $students, array $selectedByYear): array
    {
        $qualifiers = [];
        $disqualifiers = [];

        foreach ($students as $student) {
            $year = str_replace(['_', '-'], ' ', StudentRecords::normalize($student['year_level']));
            $requirements = null;
            foreach ($selectedByYear as $candidate => $value) {
                $candidateYear = str_replace(['_', '-'], ' ', StudentRecords::normalize($candidate));
                if ($candidateYear !== '' && $year !== ''
                    && ($candidateYear === $year || str_starts_with($candidateYear, $year) || str_starts_with($year, $candidateYear))) {
                    $requirements = $value;
                    break;
                }
            }

            $selected = is_array($requirements)
                ? array_fill_keys(array_filter(array_map(fn ($value) => mb_strtoupper(StudentRecords::text($value)), $requirements)), true)
                : null;
            $allSubjects = $student['subjects'] ?? [];
            $subjects = $selected === null
                ? $allSubjects
                : array_values(array_filter($allSubjects, fn ($subject) => isset($selected[mb_strtoupper(StudentRecords::text($subject['subject_code']))])));
            $valid = array_values(array_filter($subjects, fn ($subject) => is_numeric($subject['final_grade'])));
            $units = array_sum(array_map(fn ($subject) => (float) $subject['units'], $valid));
            $gwa = $units
                ? round(array_sum(array_map(fn ($subject) => (float) $subject['final_grade'] * (float) $subject['units'], $valid)) / $units * 10000) / 10000
                : null;
            $reasons = [];
            $forceNoGwa = false;
            $invalid = array_values(array_filter($subjects, fn ($subject) => ! is_numeric($subject['final_grade'])));
            if ($gwa === null) {
                $reasons[] = 'GWA could not be computed (no valid grades/units)';
            }
            if ($invalid) {
                $reasons[] = 'Has INC/DRP grade(s): '.implode(', ', array_column($invalid, 'subject_code'));
            }
            if (array_filter($valid, fn ($subject) => (float) $subject['final_grade'] >= 5)) {
                $reasons[] = 'Has failed subject (5.0)';
            }
            if (array_filter($valid, fn ($subject) => (float) $subject['final_grade'] > 2.25)) {
                $reasons[] = 'Has grade below 2.25 (lowest allowed grade is 2.25)';
            }
            if ($selected !== null) {
                $present = array_fill_keys(array_map(fn ($subject) => mb_strtoupper(StudentRecords::text($subject['subject_code'])), $allSubjects), true);
                $missing = array_diff(array_keys($selected), array_keys($present));
                if ($missing) {
                    $reasons[] = 'Missing selected subject(s): '.implode(', ', $missing);
                    $forceNoGwa = true;
                }
            } elseif (is_numeric($requirements) && (int) $requirements > count($subjects)) {
                $reasons[] = 'Has '.count($subjects).' subjects for '.$student['year_level'].'; required minimum is '.(int) $requirements;
                $forceNoGwa = true;
            }
            if ($gwa !== null && ! $forceNoGwa && $gwa > 1.75) {
                $reasons[] = 'GWA '.number_format($gwa, 4).' is above threshold 1.75';
            }

            $result = [
                ...$student,
                'gwa' => $forceNoGwa ? null : $gwa,
                'total_units' => $units,
                'disqualification_reasons' => $reasons,
            ];
            if ($reasons) {
                $disqualifiers[] = $result;
            } else {
                $qualifiers[] = [...$result, 'latin_honor' => "Dean's Lister"];
            }
        }

        usort($qualifiers, fn ($left, $right) => strcasecmp($left['course'], $right['course'])
            ?: strcasecmp($left['year_level'], $right['year_level'])
            ?: ($left['gwa'] <=> $right['gwa'])
        );

        return [$qualifiers, $disqualifiers];
    }

    private function cachedResult(string $id): ?array
    {
        if (! preg_match('/^[a-f0-9]{32}$/', $id)) {
            return null;
        }
        $row = DB::table('cached_results')->where('id', $id)->first();

        return $row ? json_decode($row->payload, true, 512, JSON_THROW_ON_ERROR) : null;
    }

    private function downloadWorkbook(Spreadsheet $spreadsheet, string $filename)
    {
        return response()->streamDownload(function () use ($spreadsheet) {
            (new Xlsx($spreadsheet))->save('php://output');
        }, $filename, ['Content-Type' => self::XLSX_MIME]);
    }
}
