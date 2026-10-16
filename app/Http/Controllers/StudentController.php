<?php

namespace App\Http\Controllers;

use App\Services\StudentRecords;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class StudentController extends Controller
{
    public function __construct(private readonly StudentRecords $records) {}

    public function verify(Request $request): JsonResponse
    {
        $search = StudentRecords::text($request->query('search'));
        if ($search === '') {
            return response()->json(['error' => 'Enter a student ID or full name.'], 400);
        }

        $record = ctype_digit($search)
            ? $this->records->record((int) $search)
            : collect($this->records->filtered(['search' => $search]))
                ->first(fn ($student) => str_contains(
                    StudentRecords::normalize($student['student_name']),
                    StudentRecords::normalize($search),
                ));

        if (! $record || $record['remarks'] !== "Dean's List eligible") {
            return response()->json(['error' => "No Dean's List match was found."], 404);
        }

        return response()->json([
            'student_name' => $record['student_name'],
            'program' => $record['program'],
            'academic_year' => $record['academic_year'],
            'semester' => $record['semester'],
            'gwa' => $record['gwa'],
            'remarks' => $record['remarks'],
        ]);
    }

    public function index(Request $request): JsonResponse
    {
        $students = $this->records->filtered($request->query());

        return response()->json(['students' => $students, 'count' => count($students)]);
    }

    public function store(Request $request): JsonResponse
    {
        $body = $request->all();
        $student = StudentRecords::studentPayload($body);
        if ($student['student_name'] === '') {
            return response()->json(['error' => 'Student name is required.'], 400);
        }

        $stamp = now()->toISOString();
        $id = DB::transaction(function () use ($student, $body, $stamp) {
            $id = DB::table('students')->insertGetId([
                ...$student,
                'created_at' => $stamp,
                'updated_at' => $stamp,
            ]);

            foreach (is_array($body['subjects'] ?? null) ? $body['subjects'] : [] as $subject) {
                if (is_array($subject)) {
                    DB::table('subjects')->insert([
                        'student_id' => $id,
                        ...StudentRecords::subjectPayload($subject),
                    ]);
                }
            }

            return (int) $id;
        });

        return response()->json($this->records->record($id), 201);
    }

    public function destroyAll(): JsonResponse
    {
        $result = DB::transaction(function () {
            $subjects = DB::table('subjects')->delete();
            $students = DB::table('students')->delete();

            return compact('students', 'subjects');
        });

        return response()->json([
            'message' => "Deleted {$result['students']} students and {$result['subjects']} subjects.",
            'students_deleted' => $result['students'],
            'subjects_deleted' => $result['subjects'],
        ]);
    }

    public function show(int $studentId): JsonResponse
    {
        $record = $this->records->record($studentId);
        if (! $record) {
            return response()->json(['error' => 'Student not found.'], 404);
        }

        return response()->json($record);
    }

    public function update(Request $request, int $studentId): JsonResponse
    {
        $current = DB::table('students')->where('id', $studentId)->first();
        if (! $current) {
            return response()->json(['error' => 'Student not found.'], 404);
        }

        $incoming = $request->all();
        $student = (array) $current;
        $fields = [
            'student_name' => ['student_name', 'name'],
            'academic_year' => ['academic_year', 'school_year'],
            'semester' => ['semester'],
            'program' => ['program', 'course'],
            'year_level' => ['year_level'],
            'section' => ['section'],
            'remarks' => ['remarks'],
        ];
        foreach ($fields as $field => $aliases) {
            foreach ($aliases as $alias) {
                if (array_key_exists($alias, $incoming)) {
                    $student[$field] = StudentRecords::text($incoming[$alias]);
                    break;
                }
            }
        }

        if ($student['student_name'] === '') {
            return response()->json(['error' => 'Student name is required.'], 400);
        }

        DB::transaction(function () use ($incoming, $student, $studentId) {
            DB::table('students')->where('id', $studentId)->update([
                'student_name' => $student['student_name'],
                'academic_year' => $student['academic_year'],
                'semester' => $student['semester'],
                'program' => $student['program'],
                'year_level' => $student['year_level'],
                'section' => $student['section'],
                'remarks' => $student['remarks'],
                'updated_at' => now()->toISOString(),
            ]);

            if (isset($incoming['subjects']) && is_array($incoming['subjects'])) {
                DB::table('subjects')->where('student_id', $studentId)->delete();
                foreach ($incoming['subjects'] as $subject) {
                    if (is_array($subject)) {
                        DB::table('subjects')->insert([
                            'student_id' => $studentId,
                            ...StudentRecords::subjectPayload($subject),
                        ]);
                    }
                }
            }
        });

        return response()->json($this->records->record($studentId));
    }

    public function destroy(int $studentId): JsonResponse
    {
        $deleted = DB::table('students')->where('id', $studentId)->delete();
        if (! $deleted) {
            return response()->json(['error' => 'Student not found.'], 404);
        }

        return response()->json(['message' => 'Student deleted.']);
    }

    public function subjects(Request $request): JsonResponse
    {
        $query = DB::table('subjects')->orderBy('id');
        if ((int) $request->query('student_id', 0) > 0) {
            $query->where('student_id', (int) $request->query('student_id'));
        }

        return response()->json(['subjects' => $query->get()]);
    }

    public function storeSubject(Request $request): JsonResponse
    {
        $studentId = (int) $request->input('student_id', 0);
        if (! DB::table('students')->where('id', $studentId)->exists()) {
            return response()->json(['error' => 'A valid student_id is required.'], 400);
        }

        $id = DB::table('subjects')->insertGetId([
            'student_id' => $studentId,
            ...StudentRecords::subjectPayload($request->all()),
        ]);

        return response()->json(DB::table('subjects')->where('id', $id)->first(), 201);
    }

    public function updateSubject(Request $request, int $subjectId): JsonResponse
    {
        $current = DB::table('subjects')->where('id', $subjectId)->first();
        if (! $current) {
            return response()->json(['error' => 'Subject not found.'], 404);
        }

        $subject = (array) $current;
        $aliases = [
            'subject_code' => ['subject_code', 'code'],
            'subject_description' => ['subject_description', 'description'],
            'units' => ['units'],
            'grade' => ['grade', 'gwa'],
            'remarks' => ['remarks'],
        ];
        foreach ($aliases as $field => $names) {
            foreach ($names as $name) {
                if (array_key_exists($name, $request->all())) {
                    $subject[$field] = match ($field) {
                        'units' => StudentRecords::number($request->input($name)),
                        'grade' => StudentRecords::grade($request->input($name)),
                        default => StudentRecords::text($request->input($name)),
                    };
                    break;
                }
            }
        }

        DB::table('subjects')->where('id', $subjectId)->update([
            'subject_code' => $subject['subject_code'],
            'subject_description' => $subject['subject_description'],
            'units' => $subject['units'],
            'grade' => $subject['grade'],
            'remarks' => $subject['remarks'],
        ]);

        return response()->json(DB::table('subjects')->where('id', $subjectId)->first());
    }

    public function destroySubject(int $subjectId): JsonResponse
    {
        if (! DB::table('subjects')->where('id', $subjectId)->delete()) {
            return response()->json(['error' => 'Subject not found.'], 404);
        }

        return response()->json(['message' => 'Subject deleted.']);
    }

    public function options(): JsonResponse
    {
        $options = [];
        foreach (['academic_year', 'semester', 'program', 'year_level', 'section'] as $field) {
            $options[$field] = DB::table('students')
                ->where($field, '<>', '')
                ->distinct()
                ->orderBy($field)
                ->pluck($field);
        }
        $options['subject_codes'] = DB::table('subjects')
            ->where('subject_code', '<>', '')
            ->distinct()
            ->orderBy('subject_code')
            ->pluck('subject_code');

        return response()->json($options);
    }

    public function dashboard(Request $request): JsonResponse
    {
        $records = $this->records->filtered($request->query());
        $graded = array_values(array_filter($records, fn ($student) => $student['gwa'] !== null));
        $terms = [];
        foreach ($records as $record) {
            if ($record['academic_year'] || $record['semester']) {
                $terms[$record['academic_year']."\0".$record['semester']] = true;
            }
        }

        return response()->json([
            'total_students' => count($records),
            'total_units' => round(array_sum(array_column($records, 'total_units')) * 100) / 100,
            'average_gwa' => count($graded)
                ? round(array_sum(array_column($graded, 'gwa')) / count($graded) * 10000) / 10000
                : null,
            'active_terms' => count($terms),
        ]);
    }
}
