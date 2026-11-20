// Tira a data dos lembretes de post concluídos: lembrete com data aparece no app Calendário, em qualquer lista.
// Só mexe em lembrete concluído cujo nome começa com "Postar ". Não apaga nada.
// Compilar: swiftc scripts/lembretes-sem-data.swift -o "$HOME/Library/Application Support/LembretesPostagens/sem-data"
// Uso: sem-data [--conferir]
import EventKit
import Foundation

let store = EKEventStore()
let acesso = DispatchSemaphore(value: 0)
var ok = false
store.requestFullAccessToReminders { y, _ in ok = y; acesso.signal() }
acesso.wait()
guard ok else { print("sem-data: sem acesso aos Lembretes"); exit(2) }
let fim = DispatchSemaphore(value: 0)
var itens: [EKReminder] = []
store.fetchReminders(matching: store.predicateForReminders(in: nil)) { r in itens = r ?? []; fim.signal() }
fim.wait()
let posts = itens.filter { ($0.title ?? "").hasPrefix("Postar ") }
let alvo = posts.filter { $0.isCompleted && $0.dueDateComponents != nil }
if CommandLine.arguments.contains("--conferir") {
  var dias: [String: [String]] = [:]
  for r in posts where !r.isCompleted {
    guard let d = r.dueDateComponents else { continue }
    dias[String(format: "%02d/%02d", d.day ?? 0, d.month ?? 0), default: []].append(String(format: "%02d:%02d", d.hour ?? 0, d.minute ?? 0))
  }
  print("concluidos com data:", alvo.count, "· abertos com data:", dias.values.map(\.count).reduce(0, +))
  for k in dias.keys.sorted() { print(k, dias[k]!.sorted().joined(separator: " ")) }
  var porLista: [String: Int] = [:]
  for r in posts { porLista[r.calendar.title, default: 0] += 1 }
  print(porLista)
  exit(0)
}
for r in alvo { r.dueDateComponents = nil; r.startDateComponents = nil; r.alarms = nil; try store.save(r, commit: false) }
if !alvo.isEmpty { try store.commit(); print("sem-data: \(alvo.count) tirados da agenda") }
