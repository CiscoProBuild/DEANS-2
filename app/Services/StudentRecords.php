<?php

namespace App\Services;

use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

class StudentRecords
{
    public static function text(mixed $value): string
    {
        return trim((string) ($value ?? ''));
    }

    public static function normalize(mixed $value): string
    {
        return mb_strtolower((string) preg_replace('/\s+/u', ' ', self::text($value)));
    }

    public static function number(mixed $value, float $fallback = 0): float
    {
        if (! is_numeric($value)) {
            return $fallback;
        }

        $number = (float) $value;

        return is_finite($number) && $number >= 0 ? $number : $fallback;
    }

    public static function grade(mixed $value): ?float
    {
        if ($value === null || $value === '') {
            return null;
        }

        return is_numeric($value) && is_finite((float) $value) ? (float) $value : null;
    }

    public function record(int $id): ?array
    {
        $student = DB::table('students')->where('id', $id)->first();
        if (! $student) {
            return null;
        }

        $subjects = DB::table('subjects')
            ->where('student_id', $id)
            ->orderBy('id')
            ->get()
            ->map(fn ($subject) => (array) $subject)
            ->all();
        $totalUnits = round(array_sum(array_map(fn ($subject) => (float) $subject['units'], $subjects)) * 100) / 100;
        $complete = count($subjects) > 0 && count(array_filter($subjects, fn ($subject) => $subject['grade'] !== null)) === count($subjects);
        $graded = array_values(array_filter($subjects, fn ($subject) => $subject['grade'] !== null));
        $unitSum = array_sum(array_map(fn ($subject) => (float) $subject['units'], $graded));
        $gwa = $complete && $unitSum > 0
            ? round(array_sum(array_map(fn ($subject) => (float) $subject['grade'] * (float) $subject['units'], $graded)) / $unitSum * 10000) / 10000
            : null;

        $result = array_merge((array) $student, [
            'subjects' => $subjects,
            'total_units' => $totalUnits,
            'gwa' => $gwa,
        ]);

        if (count($subjects) > 0 && ! $complete) {
            $result['remarks'] = 'NO GRADE - Grades incomplete';
        } elseif ($result['remarks']) {
            // Preserve registrar-supplied remarks.
        } elseif (! count($subjects)) {
            $result['remarks'] = 'No subjects recorded';
        } elseif ($gwa === null) {
            $result['remarks'] = 'Grades pending';
        } elseif ($gwa <= 1.75 && count(array_filter($subjects, fn ($subject) => $subject['grade'] !== null && (float) $subject['grade'] <= 2.25)) === count($subjects)) {
            $result['remarks'] = "Dean's List eligible";
        } else {
            $result['remarks'] = 'For review';
        }

        return $result;
    }

    public function filtered(array $filters): array
    {
        $query = DB::table('students as s');

        foreach (['academic_year', 'semester', 'program', 'year_level', 'section'] as $field) {
            $value = self::text($filters[$field] ?? '');
            if ($value !== '') {
                $query->where("s.$field", $value);
            }
        }

        $search = self::text($filters['search'] ?? '');
        if ($search !== '') {
            $like = '%'.$search.'%';
            $query->where(function (Builder $builder) use ($like) {
                $builder->where('s.student_name', 'like', $like)
                    ->orWhere('s.program', 'like', $like)
                    ->orWhere('s.section', 'like', $like)
                    ->orWhereExists(function (Builder $subjects) use ($like) {
                        $subjects->selectRaw('1')
                            ->from('subjects as sx')
                            ->whereColumn('sx.student_id', 's.id')
                            ->where(function (Builder $subjectSearch) use ($like) {
                                $subjectSearch->where('sx.subject_code', 'like', $like)
                                    ->orWhere('sx.subject_description', 'like', $like);
                            });
                    });
            });
        }

        $records = $query->select('s.id')
            ->orderBy('s.student_name')
            ->orderBy('s.id')
            ->get()
            ->map(fn ($row) => $this->record((int) $row->id))
            ->filter()
            ->values()
            ->all();

        $yearOrder = fn ($value) => preg_match('/\d+/', self::text($value), $matches) ? (int) $matches[0] : 999;
        $sectionOrder = function ($value) {
            $section = mb_strtoupper(self::text($value));

            return preg_match('/^(\d+)/', $section, $matches)
                ? [0, (int) $matches[1], $section]
                : [1, 0, $section];
        };

        usort($records, function ($left, $right) use ($yearOrder, $sectionOrder) {
            $year = $yearOrder($left['year_level']) <=> $yearOrder($right['year_level']);
            if ($year !== 0) {
                return $year;
            }

            $section = $sectionOrder($left['section']) <=> $sectionOrder($right['section']);
            if ($section !== 0) {
                return $section;
            }

            $gwa = ($left['gwa'] ?? INF) <=> ($right['gwa'] ?? INF);

            return $gwa !== 0 ? $gwa : strcasecmp($left['student_name'], $right['student_name']);
        });

        return $records;
    }

    public static function studentPayload(array $body): array
    {
        return [
            'student_name' => self::alias($body, ['student_name', 'name']),
            'academic_year' => self::alias($body, ['academic_year', 'school_year']),
            'semester' => self::alias($body, ['semester']),
            'program' => self::alias($body, ['program', 'course']),
            'year_level' => self::alias($body, ['year_level']),
            'section' => self::alias($body, ['section']),
            'remarks' => self::alias($body, ['remarks']),
        ];
    }

    public static function subjectPayload(array $body): array
    {
        return [
            'subject_code' => self::alias($body, ['subject_code', 'code']),
            'subject_description' => self::alias($body, ['subject_description', 'description']),
            'units' => self::number($body['units'] ?? null),
            'grade' => self::grade($body['grade'] ?? $body['gwa'] ?? null),
            'remarks' => self::alias($body, ['remarks']),
        ];
    }

    private static function alias(array $body, array $names): string
    {
        foreach ($names as $name) {
            if (array_key_exists($name, $body)) {
                return self::text($body[$name]);
            }
        }

        return '';
    }
}
