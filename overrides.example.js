export default {
  '9b37a71e1b31de98289ff2341114338fdf3b113747b7799bf524a676e5ac668c@group.calendar.google.com': events => {
    return events.map(event => {
      const { description: descriptionBase, ...rest } = event

      const description = descriptionBase.split('\n').shift().trim()

      return {
        ...rest,
        description,
      }
    })
  },
}
