import { describe, expect, test } from "bun:test";
import { classForName, matchCourses } from "../convex/lib/match";

// An invented school: timetable classes as Compass has them, courses as Canvas has them.
const classes = [
  { code: "9MAT2", subject: "Year 9 Mathematics", teachers: ["jmarlow"] },
  { code: "9ENG1", subject: "Year 9 English", teachers: ["pkendrick"] },
  { code: "9SCI3", subject: "Year 9 Science", teachers: ["rokafor"] },
  { code: "9DT", subject: "Year 9 Digital Technology", teachers: ["tvasquez"] },
  { code: "9FT1", subject: "Year 9 Food Technology", teachers: ["hlindqvist"] },
  { code: "HR9B", subject: "Homeroom", teachers: ["jmarlow"] },
];
const course = (id: string, name: string, code: string | null, teachers: string[] = []) => ({ id, name, code, teachers });

describe("matchCourses", () => {
  test("by code, by name, and never homeroom", () => {
    const courses = [
      course("1", "9 Mathematics Core", "9MAT"),
      course("2", "Year 9 English", null),
      course("3", "9 Science", "9SCI"),
      course("4", "9 Digital Technology", null),
      course("5", "Year 9 Assessments", "9ASSESS"),
      course("6", "Homeroom 9B", null),
    ];
    const m = matchCourses(classes, courses);
    expect(m.get("9MAT2")?.id).toBe("1");
    expect(m.get("9ENG1")?.id).toBe("2");
    expect(m.get("9SCI3")?.id).toBe("3");
    expect(m.get("9DT")?.id).toBe("4");
    expect(m.has("HR9B")).toBe(false);
    expect([...m.values()].map(c => c.id)).not.toContain("5");
  });

  test("a word every technology course has is not a match", () => {
    const m = matchCourses(classes, [course("1", "9 Digital Technology", null), course("2", "9 Industrial Technology", null)]);
    expect(m.get("9DT")?.id).toBe("1");
    expect(m.has("9FT1")).toBe(false);
  });

  test("a shared teacher settles two courses with the same words", () => {
    const m = matchCourses(classes, [course("1", "Science", null, ["Ms Aisha Brennan"]), course("2", "Science", null, ["Mrs Rose Okafor"])]);
    expect(m.get("9SCI3")?.id).toBe("2");
  });

  test("each course goes to one class", () => {
    const twoMaths = [...classes, { code: "9MAT4", subject: "Year 9 Mathematics", teachers: ["kwu"] }];
    const m = matchCourses(twoMaths, [course("1", "9 Mathematics", null, ["Kim Wu"])]);
    expect(m.get("9MAT4")?.id).toBe("1");
    expect(m.has("9MAT2")).toBe(false);
  });
});

describe("classForName", () => {
  test("names the class by subject, short name or code", () => {
    expect(classForName("Digital Technology Task 2 - Test", classes)).toBe("9DT");
    expect(classForName("DT Task 2", classes)).toBe("9DT");
    expect(classForName("Maths Assessment Task 3", classes)).toBe("9MAT2");
    expect(classForName("Science half-yearly exam", classes)).toBe("9SCI3");
  });

  test("names nothing, or two classes equally: no class", () => {
    expect(classForName("Library book return", classes)).toBeNull();
    expect(classForName("Technology week", classes)).toBeNull();
  });
});
