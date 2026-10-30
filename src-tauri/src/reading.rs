use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

// A document has a goal of its own (`Custom`) or none of its own. `Inherit` and `None` both mean
// "no goal of its own": the document only counts in the general goal, which is all the reading of
// the day. The three values stay valid, so catalogs and goal histories written by earlier versions
// keep opening as they were; the interface saves `Inherit` for "no goal of its own".
#[derive(Serialize, Deserialize, Clone, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub enum GoalMode {
    #[default]
    Inherit,
    Custom,
    None,
}
#[derive(Serialize, Deserialize, Clone, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub enum GoalUnit {
    #[default]
    Pages,
    Chapters,
}
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct BookGoal {
    pub mode: GoalMode,
    pub unit: GoalUnit,
    pub target: u32,
}
impl Default for BookGoal {
    fn default() -> Self {
        Self {
            mode: GoalMode::Inherit,
            unit: GoalUnit::Pages,
            target: 10,
        }
    }
}
impl BookGoal {
    pub fn validate(&self) -> Result<(), String> {
        if !(1..=10000).contains(&self.target) {
            return Err("A meta deve estar entre 1 e 10.000.".into());
        }
        Ok(())
    }
}
#[derive(Serialize, Deserialize, Clone, Default, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct ReadingDay {
    pub pages: Vec<u32>,
    pub chapters: Vec<u32>,
    pub page_adjustment: i32,
    pub chapter_adjustment: i32,
}
pub type ReadingDays = BTreeMap<String, ReadingDay>;
pub type GoalHistory = BTreeMap<String, BookGoal>;
pub fn valid_day(key: &str) -> bool {
    let parts: Vec<_> = key.split('-').collect();
    if parts.len() != 3 || parts[0].len() != 4 || parts[1].len() != 2 || parts[2].len() != 2 {
        return false;
    }
    let (Ok(year), Ok(month), Ok(day)) = (
        parts[0].parse::<u32>(),
        parts[1].parse::<usize>(),
        parts[2].parse::<u32>(),
    ) else {
        return false;
    };
    let leap = year.is_multiple_of(4) && (!year.is_multiple_of(100) || year.is_multiple_of(400));
    let days = [
        31,
        if leap { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    (1900..=9999).contains(&year) && (1..=12).contains(&month) && day >= 1 && day <= days[month - 1]
}
pub fn validate_days(mut days: ReadingDays, pages: u32) -> Result<ReadingDays, String> {
    if days.len() > 36500 {
        return Err("Histórico diário excede o limite de 100 anos.".into());
    }
    for (key, day) in &mut days {
        if !valid_day(key)
            || day.pages.len() > 100000
            || day.chapters.len() > 10000
            || day.page_adjustment.unsigned_abs() > 100000
            || day.chapter_adjustment.unsigned_abs() > 100000
            || day
                .pages
                .iter()
                .chain(&day.chapters)
                .any(|n| *n == 0 || *n > pages)
        {
            return Err("Registro diário inválido.".into());
        }
        day.pages.sort_unstable();
        day.pages.dedup();
        day.chapters.sort_unstable();
        day.chapters.dedup();
    }
    Ok(days)
}
