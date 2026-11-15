'use client'

import ShiftCloseWizard from '@/components/ShiftCloseWizard'

export default function SupervisorPage() {
  // Temporary hard-coded values for testing
  // Later we will make this dynamic (login + select station/shift)
  const shiftId = 'temp-shift-id'
  const pumps = [
    { id: '1', pump_number: 1, fuel_grade: 'PMS', nozzle_label: 'Nozzle 1 - Super' },
    { id: '2', pump_number: 2, fuel_grade: 'PMS', nozzle_label: 'Nozzle 2 - Super' },
    { id: '3', pump_number: 3, fuel_grade: 'AGO', nozzle_label: 'Nozzle 3 - Diesel' },
    { id: '4', pump_number: 4, fuel_grade: 'LPG', nozzle_label: 'LPG Dispenser 1' },
  ]

  return (
    <div>
      <ShiftCloseWizard 
        shiftId={shiftId} 
        pumps={pumps} 
        onComplete={() => alert('Shift closed successfully!')} 
      />
    </div>
  )
}