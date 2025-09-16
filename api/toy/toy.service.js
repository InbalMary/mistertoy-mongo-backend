import { ObjectId } from 'mongodb'

import { dbService } from '../../services/db.service.js'
import { logger } from '../../services/logger.service.js'
import { utilService } from '../../services/util.service.js'
import { asyncLocalStorage } from '../../services/als.service.js'

export const toyService = {
	remove,
	query,
	getById,
	add,
	update,
	getLabels,
	getLabelStats,
	addToyMsg,
	removeToyMsg,
}

const PAGE_SIZE = 10

async function query(filterBy = { txt: '' }) {
	try {
		const criteria = {}
		if (filterBy.txt) {
			criteria.name = { $regex: filterBy.txt, $options: 'i' }
		}
		if (filterBy.price) { //maxPrice
			criteria.price = { $lte: +filterBy.price }
		}
		if (filterBy.inStock === 'true') {
			criteria.inStock = true
		} else if (filterBy.inStock === 'false') {
			criteria.inStock = false
		}
		if (filterBy.labels && filterBy.labels.length > 0) {
			criteria.labels = { $all: filterBy.labels }
		}
		// console.log('FINAL CRITERIA:', criteria)
		const collection = await dbService.getCollection('toy')
		// console.log('COLLECTION COUNT:', await collection.countDocuments())
		// console.log('CRITERIA COUNT:', await collection.countDocuments(criteria))

		const sortBy = {}
		if (filterBy.sort === 'name') {
			sortBy.name = 1
		} else if (filterBy.sort === 'price') {
			sortBy.price = 1
		} else if (filterBy.sort === 'createdAt') {
			sortBy.createdAt = 1
		}

		const skip = filterBy.pageIdx !== undefined ? filterBy.pageIdx * PAGE_SIZE : 0

		const prmTotalCount = collection.countDocuments(criteria)

		const prmFilteredToys = collection
			.find(criteria)
			.sort(sortBy)
			.skip(skip)
			.limit(PAGE_SIZE)
			.toArray()

		const [totalCount, filteredToys] = await Promise.all([prmTotalCount, prmFilteredToys])

		const maxPage = Math.ceil(totalCount / PAGE_SIZE)
		console.log('totalcount, maxPage', totalCount, maxPage)

		return { toys: filteredToys, maxPage }

	} catch (err) {
		logger.error('cannot find toys', err)
		throw err
	}
}

async function getById(toyId) {
	try {
		const collection = await dbService.getCollection('toy')
		const toy = await collection.findOne({ _id: ObjectId.createFromHexString(toyId) })
		if (!toy) return null

		toy.createdAt = toy._id.getTimestamp()

		return {
			...toy,
			_id: toy._id.toString()
		}
	} catch (err) {
		logger.error(`while finding toy ${toyId}`, err)
		throw err
	}
}

async function remove(toyId) {
	const { loggedinUser } = asyncLocalStorage.getStore()
    const { _id: ownerId, isAdmin } = loggedinUser

	try {
		const criteria = {
            _id: ObjectId.createFromHexString(toyId)
        }
        if (!isAdmin) criteria['owner._id'] = ownerId

		const collection = await dbService.getCollection('toy')
		const res = await collection.deleteOne(criteria)

        if (res.deletedCount === 0) throw new Error('Not your toy')

        return toyId
	} catch (err) {
		logger.error(`cannot remove toy ${toyId}`, err)
		throw err
	}
}

async function add(toy) {
	try {
		const collection = await dbService.getCollection('toy')
		await collection.insertOne(toy)
		return toy
	} catch (err) {
		logger.error('cannot insert toy', err)
		throw err
	}
}

async function update(toy) {
	try {
		const { _id, ...toyData } = toy

		const collection = await dbService.getCollection('toy')
		await collection.updateOne(
			{ _id: ObjectId.createFromHexString(_id) },
			{ $set: toyData })

		const updatedToy = await collection.findOne({ _id: ObjectId.createFromHexString(_id) })
		return {
			...updatedToy,
			_id: updatedToy._id.toString()
		}
	} catch (err) {
		logger.error(`cannot update toy ${toy._id}`, err)
		throw err
	}
}

async function addToyMsg(toyId, msg) {
	try {
		msg.id = utilService.makeId()

		const collection = await dbService.getCollection('toy')
		await collection.updateOne({ _id: ObjectId.createFromHexString(toyId) }, { $push: { msgs: msg } })
		return msg
	} catch (err) {
		logger.error(`cannot add toy msg ${toyId}`, err)
		throw err
	}
}

async function removeToyMsg(toyId, msgId) {
	try {
		const collection = await dbService.getCollection('toy')
		await collection.updateOne({ _id: ObjectId.createFromHexString(toyId) }, { $pull: { msgs: { id: msgId } } })
		const updatedToy = await collection.findOne({ _id: ObjectId.createFromHexString(toyId) })
		return updatedToy
		// return msgId
	} catch (err) {
		logger.error(`cannot add toy msg ${toyId}`, err)
		throw err
	}
}

async function getLabels() {
	try {
		const collection = await dbService.getCollection('toy')

		const labels = await collection.aggregate([
			{ $unwind: '$labels' },
			{ $group: { _id: '$labels' } },
			{ $sort: { _id: 1 } }
		]).toArray()

		return labels.map(labelDoc => labelDoc._id)

	} catch (err) {
		logger.error('cannot get labels', err)
		throw err
	}
}

async function getLabelStats() {
	try {
		const collection = await dbService.getCollection('toy')

		const stats = await collection.aggregate([
			{ $match: { labels: { $exists: true, $ne: [] } } },
			{ $unwind: '$labels' },
			{
				$group: {
					_id: '$labels',
					prices: { $push: '$price' },
					total: { $sum: 1 },
					inStock: {
						$sum: {
							$cond: [
								{ $or: [{ $eq: ['$inStock', true] }, { $eq: ['$inStock', 'true'] }] },
								1,
								0
							]
						}
					}
				}
			},
			{
				$project: {
					avgPrice: {
						$round: [
							{ $avg: '$prices' },
							2
						]
					},
					total: 1,
					inStock: 1,
					percent: {
						$round: [
							{
								$multiply: [
									{ $divide: ['$inStock', '$total'] },
									100
								]
							},
							2
						]
					}
				}
			},
			{ $sort: { _id: 1 } }
		]).toArray()

		const labelStats = {}
		stats.forEach(stat => {
			labelStats[stat._id] = {
				avgPrice: stat.avgPrice,
				total: stat.total,
				inStock: stat.inStock,
				percent: stat.percent
			}
		})

		return labelStats

	} catch (err) {
		logger.error('cannot get label stats', err)
		throw err
	}
}
